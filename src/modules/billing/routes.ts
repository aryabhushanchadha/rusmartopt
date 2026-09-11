import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as billingService from "./service.js";
import { checkoutSchema } from "./schema.js";

export const billingRouter = Router();

// Public — no session required, matches src/modules/tracking's pattern of
// keeping unauthenticated read-only endpoints outside the auth chain.
billingRouter.get("/promo-status", async (_req, res, next) => {
  try {
    res.json(await billingService.getPromoStatus());
  } catch (err) { next(err); }
});

billingRouter.use(requireAuth);

billingRouter.get("/subscription", async (req, res, next) => {
  try {
    res.json(await billingService.getOwnSubscription(req.user!));
  } catch (err) { next(err); }
});

billingRouter.post("/checkout", async (req, res, next) => {
  try {
    const input = checkoutSchema.parse(req.body);
    res.json(await billingService.createCheckout(req.user!, input.plan));
  } catch (err) { next(err); }
});

billingRouter.post("/cancel", async (req, res, next) => {
  try {
    res.json(await billingService.cancelSubscription(req.user!));
  } catch (err) { next(err); }
});

billingRouter.get("/payments", async (req, res, next) => {
  try {
    res.json(await billingService.getOwnPayments(req.user!));
  } catch (err) { next(err); }
});
