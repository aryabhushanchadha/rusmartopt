import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import * as ordersService from "./service.js";
import { createOrderSchema, updateOrderSchema, advanceStageSchema, shipSchema, updateShipStageSchema } from "./schema.js";
import { prisma } from "../../db/prisma.js";
import { HttpError } from "../../middleware/errorHandler.js";

export const ordersRouter = Router();

ordersRouter.use(requireAuth, requireRole("supplier", "buyer"));

async function actorName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.fullName ?? "Система";
}

ordersRouter.get("/", async (req, res, next) => {
  try {
    res.json(await ordersService.listOrders(req.user!));
  } catch (err) { next(err); }
});

ordersRouter.post("/", async (req, res, next) => {
  try {
    const input = createOrderSchema.parse(req.body);
    res.status(201).json(await ordersService.createOrder(req.user!, input));
  } catch (err) { next(err); }
});

ordersRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await ordersService.getOrder(req.user!, req.params.id));
  } catch (err) { next(err); }
});

ordersRouter.patch("/:id", async (req, res, next) => {
  try {
    const input = updateOrderSchema.parse(req.body);
    res.json(await ordersService.updateOrder(req.user!, req.params.id, input));
  } catch (err) { next(err); }
});

ordersRouter.post("/:id/stage", async (req, res, next) => {
  try {
    const input = advanceStageSchema.parse(req.body ?? {});
    const name = await actorName(req.user!.userId);
    res.json(await ordersService.advanceStage(req.user!, req.params.id, name, input.note));
  } catch (err) { next(err); }
});

ordersRouter.post("/:id/ship", async (req, res, next) => {
  try {
    const input = shipSchema.parse(req.body ?? {});
    const name = await actorName(req.user!.userId);
    res.json(await ordersService.shipOrder(req.user!, req.params.id, name, input.trackingNumber));
  } catch (err) { next(err); }
});

ordersRouter.patch("/:id/ship-stage", async (req, res, next) => {
  try {
    const input = updateShipStageSchema.parse(req.body);
    const name = await actorName(req.user!.userId);
    res.json(await ordersService.updateShipStage(req.user!, req.params.id, input.shipStage, name));
  } catch (err) { next(err); }
});

ordersRouter.get("/:id/log", async (req, res, next) => {
  try {
    res.json(await ordersService.getOrderLog(req.user!, req.params.id));
  } catch (err) { next(err); }
});

ordersRouter.get("/:id/notifications", async (req, res, next) => {
  try {
    res.json(await ordersService.getOrderNotifications(req.user!, req.params.id));
  } catch (err) { next(err); }
});

ordersRouter.post("/:id/notify", async (req, res, next) => {
  try {
    const result = await ordersService.manualNotify(req.user!, req.params.id);
    if (!result) throw new HttpError(500, "Не удалось отправить уведомление");
    res.json(result);
  } catch (err) { next(err); }
});
