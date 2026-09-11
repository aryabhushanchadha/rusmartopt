import { prisma } from "../../db/prisma.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { generateOrderCode, randomToken } from "../../utils/tokens.js";
import { sendOrderNotification } from "../notifications/service.js";
import { STAGE_MAX } from "./schema.js";
import type { SessionData } from "../auth/session.js";

/**
 * Every read here is scoped by companyId from the authenticated session — never
 * a client-supplied value. A supplier only ever sees orders where
 * sellerCompanyId === session.companyId; a buyer only where
 * buyerCompanyId === session.companyId. Fetching a specific order that exists
 * but belongs to another company returns 404 (not 403), so the endpoint never
 * confirms whether a given order id exists for someone who can't access it.
 */

function tenantWhere(user: SessionData) {
  if (user.role === "supplier") return { sellerCompanyId: user.companyId! };
  if (user.role === "buyer") return { buyerCompanyId: user.companyId! };
  return {}; // admin: unscoped (schema-ready for future admin UI, not exposed via routes yet)
}

export async function listOrders(user: SessionData) {
  return prisma.order.findMany({
    where: tenantWhere(user),
    orderBy: { createdAt: "desc" },
  });
}

export async function getOrder(user: SessionData, id: string) {
  const order = await prisma.order.findFirst({ where: { id, ...tenantWhere(user) } });
  if (!order) throw new HttpError(404, "Заказ не найден");
  return order;
}

export async function createOrder(user: SessionData, input: {
  buyerCompanyName: string; product: string; qty: number; price: number;
  city: string; phone: string; notifyChannel: "telegram" | "sms"; dueDate: Date;
}) {
  if (user.role !== "supplier" || !user.companyId) {
    throw new HttpError(403, "Только поставщик может создавать заказы");
  }
  // Link to a registered buyer's account when one matches by name, so the
  // order actually shows up in their portal (GET /api/orders scopes buyers
  // by buyerCompanyId). If no buyer with this name has registered yet, the
  // order is still created — just not visible in anyone's buyer portal until
  // one does. Case-insensitive exact match; not fuzzy, to avoid mis-linking.
  const matchedBuyer = await prisma.company.findFirst({
    where: { type: "buyer", name: { equals: input.buyerCompanyName, mode: "insensitive" } },
  });

  // order codes are display-only and not guaranteed globally unique on first try;
  // retry a few times on the rare collision rather than failing the request
  for (let attempt = 0; attempt < 5; attempt++) {
    const orderCode = generateOrderCode();
    const exists = await prisma.order.findUnique({ where: { orderCode } });
    if (exists) continue;
    return prisma.order.create({
      data: {
        orderCode,
        publicTrackingToken: randomToken(16),
        sellerCompanyId: user.companyId,
        buyerCompanyId: matchedBuyer?.id,
        buyerCompanyName: input.buyerCompanyName,
        product: input.product,
        qty: input.qty,
        price: input.price,
        city: input.city,
        phone: input.phone,
        notifyChannel: input.notifyChannel,
        dueDate: input.dueDate,
        stage: 0,
        createdById: user.userId,
      },
    });
  }
  throw new HttpError(500, "Не удалось создать номер заказа, попробуйте снова");
}

export async function updateOrder(user: SessionData, id: string, input: Partial<{
  buyerCompanyName: string; product: string; qty: number; price: number;
  city: string; phone: string; notifyChannel: "telegram" | "sms"; dueDate: Date;
}>) {
  await getOrder(user, id); // 404s if not accessible to this tenant
  return prisma.order.update({ where: { id }, data: input });
}

export async function advanceStage(user: SessionData, id: string, actorName: string, note?: string) {
  const order = await getOrder(user, id);
  if (user.role !== "supplier") throw new HttpError(403, "Только поставщик может менять этап заказа");
  if (order.stage >= STAGE_MAX) throw new HttpError(409, "Заказ уже отгружен");

  const fromStage = order.stage;
  const toStage = order.stage === 6 ? 7 : order.stage + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const data: { stage: number; shipStage?: number; trackingNumber?: string } = { stage: toStage };
    if (toStage === 7) {
      data.shipStage = 0;
      data.trackingNumber = order.trackingNumber ?? `ZH-${Math.floor(70000000 + Math.random() * 9999999)}`;
    }
    const o = await tx.order.update({ where: { id }, data });
    await tx.orderStageLog.create({
      data: { orderId: id, fromStage, toStage, actorUserId: user.userId, actorName, note },
    });
    return o;
  });

  await sendOrderNotification(updated, toStage === 7 ? "shipped" : "stage_advanced").catch(() => {
    // notification failures are logged inside the service and never block the stage transition itself
  });

  return updated;
}

export async function shipOrder(user: SessionData, id: string, actorName: string, trackingNumber?: string) {
  const order = await getOrder(user, id);
  if (user.role !== "supplier") throw new HttpError(403, "Только поставщик может отгружать заказ");

  const fromStage = order.stage;
  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({
      where: { id },
      data: {
        stage: 7,
        shipStage: 0,
        trackingNumber: trackingNumber ?? order.trackingNumber ?? `ZH-${Math.floor(70000000 + Math.random() * 9999999)}`,
      },
    });
    await tx.orderStageLog.create({
      data: { orderId: id, fromStage, toStage: 7, actorUserId: user.userId, actorName },
    });
    return o;
  });

  await sendOrderNotification(updated, "shipped").catch(() => {});
  return updated;
}

export async function updateShipStage(user: SessionData, id: string, shipStage: number, actorName: string) {
  const order = await getOrder(user, id);
  if (user.role !== "supplier") throw new HttpError(403, "Только поставщик может обновлять статус доставки");
  if (order.stage !== 7) throw new HttpError(409, "Заказ ещё не отгружен");

  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({ where: { id }, data: { shipStage } });
    await tx.orderStageLog.create({
      data: { orderId: id, fromStage: order.shipStage ?? 0, toStage: order.stage, actorUserId: user.userId, actorName, note: `ship_stage=${shipStage}` },
    });
    return o;
  });

  await sendOrderNotification(updated, "ship_stage_advanced").catch(() => {});
  return updated;
}

export async function getOrderLog(user: SessionData, id: string) {
  await getOrder(user, id);
  return prisma.orderStageLog.findMany({ where: { orderId: id }, orderBy: { createdAt: "asc" } });
}

export async function getOrderNotifications(user: SessionData, id: string) {
  await getOrder(user, id);
  return prisma.notification.findMany({ where: { orderId: id }, orderBy: { createdAt: "desc" } });
}

export async function manualNotify(user: SessionData, id: string) {
  const order = await getOrder(user, id);
  if (user.role !== "supplier") throw new HttpError(403, "Только поставщик может отправлять уведомления");
  return sendOrderNotification(order, "manual");
}
