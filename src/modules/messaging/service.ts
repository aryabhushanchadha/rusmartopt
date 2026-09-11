import { prisma } from "../../db/prisma.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { sendMessageNotification } from "../notifications/service.js";
import type { SessionData } from "../auth/session.js";

/**
 * Tenant scoping mirrors modules/orders/service.ts and modules/listings/
 * service.ts exactly: a company is "in" a conversation if it's either side,
 * and any access by a company that's neither returns 404, never 403 — the
 * endpoint never confirms a conversation id exists to a party who can't see it.
 */
function tenantWhere(user: SessionData) {
  if (!user.companyId) return { id: "__none__" };
  return { OR: [{ buyerCompanyId: user.companyId }, { sellerCompanyId: user.companyId }] };
}

function otherCompanyId(convo: { buyerCompanyId: string; sellerCompanyId: string }, companyId: string): string {
  return convo.buyerCompanyId === companyId ? convo.sellerCompanyId : convo.buyerCompanyId;
}

export async function listConversations(user: SessionData) {
  if (!user.companyId) return [];
  const convos = await prisma.conversation.findMany({
    where: tenantWhere(user),
    include: {
      listing: true,
      buyerCompany: { select: { id: true, name: true } },
      sellerCompany: { select: { id: true, name: true } },
    },
    orderBy: { lastMessageAt: "desc" },
  });
  return Promise.all(
    convos.map(async (c) => {
      const unread = await prisma.message.count({
        where: { conversationId: c.id, senderCompanyId: otherCompanyId(c, user.companyId!), readAt: null },
      });
      return { ...c, unread };
    })
  );
}

export async function getConversation(user: SessionData, id: string) {
  const convo = await prisma.conversation.findFirst({
    where: { id, ...tenantWhere(user) },
    include: {
      listing: true,
      buyerCompany: { select: { id: true, name: true } },
      sellerCompany: { select: { id: true, name: true } },
    },
  });
  if (!convo) throw new HttpError(404, "Переписка не найдена");

  // Mark the other party's messages as read by opening the thread.
  await prisma.message.updateMany({
    where: { conversationId: id, senderCompanyId: otherCompanyId(convo, user.companyId!), readAt: null },
    data: { readAt: new Date() },
  });

  const messages = await prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } });
  return { ...convo, messages };
}

export async function unreadCount(user: SessionData): Promise<{ count: number }> {
  if (!user.companyId) return { count: 0 };
  const convos = await prisma.conversation.findMany({
    where: tenantWhere(user),
    select: { id: true, buyerCompanyId: true, sellerCompanyId: true },
  });
  let total = 0;
  for (const c of convos) {
    total += await prisma.message.count({
      where: { conversationId: c.id, senderCompanyId: otherCompanyId(c, user.companyId!), readAt: null },
    });
  }
  return { count: total };
}

export async function sendMessage(user: SessionData, conversationId: string, body: string) {
  if (!user.companyId) throw new HttpError(404, "Переписка не найдена");
  const convo = await prisma.conversation.findFirst({ where: { id: conversationId, ...tenantWhere(user) } });
  if (!convo) throw new HttpError(404, "Переписка не найдена");

  const message = await prisma.message.create({
    data: { conversationId, senderCompanyId: user.companyId, senderUserId: user.userId, body },
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });

  const recipientId = otherCompanyId(convo, user.companyId);
  const [recipient, sender] = await Promise.all([
    prisma.company.findUnique({ where: { id: recipientId } }),
    prisma.user.findUnique({ where: { id: user.userId } }),
  ]);
  if (recipient) {
    await sendMessageNotification(recipient, convo, sender?.fullName ?? "Пользователь").catch(() => {});
  }
  return message;
}

/** Buyer-only: start (or continue, per the (listingId, buyerCompanyId) unique constraint) a thread about a published listing. */
export async function startConversation(user: SessionData, listingId: string, messageBody: string) {
  if (user.role !== "buyer" || !user.companyId) {
    throw new HttpError(403, "Только покупатель может написать поставщику");
  }
  const listing = await prisma.listing.findFirst({ where: { id: listingId, published: true } });
  if (!listing) throw new HttpError(404, "Товар не найден");

  let convo = await prisma.conversation.findUnique({
    where: { listingId_buyerCompanyId: { listingId, buyerCompanyId: user.companyId } },
  });
  if (!convo) {
    convo = await prisma.conversation.create({
      data: { listingId, buyerCompanyId: user.companyId, sellerCompanyId: listing.companyId },
    });
  }
  await sendMessage(user, convo.id, messageBody);
  return getConversation(user, convo.id);
}
