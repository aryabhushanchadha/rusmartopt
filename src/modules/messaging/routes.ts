import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { userRateLimit } from "../../middleware/rateLimit.js";
import * as messagingService from "./service.js";
import { startConversationSchema, sendMessageSchema } from "./schema.js";

export const messagingRouter = Router();

messagingRouter.use(requireAuth, requireRole("supplier", "buyer"));

messagingRouter.get("/", async (req, res, next) => {
  try {
    res.json(await messagingService.listConversations(req.user!));
  } catch (err) { next(err); }
});

messagingRouter.get("/unread-count", async (req, res, next) => {
  try {
    res.json(await messagingService.unreadCount(req.user!));
  } catch (err) { next(err); }
});

// Each of these fires a real SMS/Telegram send on success (see
// notifications/service.ts) — unlimited posting is a paid-API abuse vector,
// not just a spam nuisance. Scoped per-account, not per-IP.
messagingRouter.post("/", requireRole("buyer"), userRateLimit("conversations:start", 20, 3600), async (req, res, next) => {
  try {
    const input = startConversationSchema.parse(req.body);
    res.status(201).json(await messagingService.startConversation(req.user!, input.listingId, input.message));
  } catch (err) { next(err); }
});

messagingRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await messagingService.getConversation(req.user!, req.params.id));
  } catch (err) { next(err); }
});

messagingRouter.post("/:id/messages", userRateLimit("conversations:send", 60, 3600), async (req, res, next) => {
  try {
    const input = sendMessageSchema.parse(req.body);
    res.status(201).json(await messagingService.sendMessage(req.user!, req.params.id, input.message));
  } catch (err) { next(err); }
});
