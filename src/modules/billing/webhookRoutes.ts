import { Router } from "express";
import { processYookassaWebhook } from "./webhookService.js";
import { clientIp } from "../../middleware/rateLimit.js";

export const billingWebhookRouter = Router();

// No requireCsrfHeader here — this is a server-to-server call from ЮKassa,
// not a browser request, so there's no session cookie and nothing to CSRF.
// Security is IP allowlist + re-fetch verification, both inside
// processYookassaWebhook — see webhookService.ts for the full model.
billingWebhookRouter.post("/webhook/yookassa", async (req, res) => {
  try {
    await processYookassaWebhook(JSON.stringify(req.body ?? {}), clientIp(req));
  } catch {
    // Swallow — always 200 so YooKassa doesn't retry on our internal errors
    // in a tight loop; webhookService.ts already logs whatever went wrong.
  }
  res.status(200).send("ok");
});
