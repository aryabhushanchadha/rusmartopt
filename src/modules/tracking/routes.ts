import { Router } from "express";
import { trackLookupSchema } from "./schema.js";
import * as trackingService from "./service.js";
import { TrackingRateLimited, TrackingNotFound } from "./service.js";
import { clientIp } from "../../middleware/rateLimit.js";

export const trackingRouter = Router();

const GENERIC_NOT_FOUND = "Не найдено. Проверьте номер заказа и последние 4 цифры телефона.";
const GENERIC_RATE_LIMITED = "Слишком много попыток. Попробуйте позже или войдите в личный кабинет.";

trackingRouter.post("/lookup", async (req, res) => {
  try {
    const input = trackLookupSchema.parse(req.body);
    const result = await trackingService.lookupByCodeAndPhone(input.orderCode, input.phoneLast4, clientIp(req));
    res.json(result);
  } catch (err) {
    if (err instanceof TrackingRateLimited) {
      res.status(429).json({ error: GENERIC_RATE_LIMITED });
      return;
    }
    if (err instanceof TrackingNotFound) {
      // Deliberately 404 with the SAME message/status regardless of whether the
      // order code doesn't exist or the phone digits were wrong.
      res.status(404).json({ error: GENERIC_NOT_FOUND });
      return;
    }
    if (err && typeof err === "object" && "issues" in err) {
      res.status(400).json({ error: "Некорректные данные" });
      return;
    }
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

trackingRouter.get("/:token", async (req, res) => {
  try {
    const result = await trackingService.lookupByToken(req.params.token);
    res.json(result);
  } catch {
    res.status(404).json({ error: GENERIC_NOT_FOUND });
  }
});
