import { prisma } from "../../db/prisma.js";
import { logger } from "../../utils/logger.js";
import { paymentProvider, activatePayment, markPaymentCanceled } from "./service.js";

/**
 * Processes an incoming ЮKassa webhook delivery. Security model, in order:
 *
 * 1. IP allowlist — cheap first-pass reject. Not the real security boundary
 *    (IPs can theoretically be spoofed at lower layers, and this list can go
 *    stale), just a fast filter.
 * 2. Idempotency ledger insert — a unique-constraint violation means this
 *    exact (providerPaymentId, eventType) was already processed or is a
 *    concurrent retry; return immediately with zero further side effects.
 *    This happens BEFORE any state mutation, and is itself provider-agnostic
 *    (works even if step 3 below were ever compromised).
 * 3. The actual authentication: re-fetch the payment from ЮKassa using our
 *    own secret-key credentials (paymentProvider.fetchPayment). The webhook
 *    BODY's status field is never read or trusted for anything beyond
 *    extracting the payment id to re-fetch — a forged POST cannot forge what
 *    our own authenticated GET returns.
 *
 * Note on the `payment.status !== "pending"` check below: it's a cheap
 * fast-path that skips an unnecessary ЮKassa API call, NOT the actual
 * concurrency guard — two different event types for the same payment could
 * both pass it before either has written anything (the ledger insert above
 * only dedupes identical (providerPaymentId, eventType) pairs). The real
 * guard is the atomic `updateMany({..., status: "pending"})` claim inside
 * activatePayment/markPaymentCanceled (service.ts) — only the call whose
 * conditional update actually matches a row proceeds to mutate the
 * subscription or send a notification.
 *
 * Always returns normally (never throws) so the HTTP handler can return 200
 * even for untrusted/duplicate/unknown deliveries — ЮKassa retries on
 * anything other than 200, and there is nothing useful a retry would fix for
 * those cases.
 */
export async function processYookassaWebhook(rawBody: string, sourceIp: string): Promise<void> {
  if (!paymentProvider.isWebhookSourceTrusted(sourceIp)) {
    logger.warn("Rejected webhook from untrusted source IP", { sourceIp });
    return;
  }

  let notification: { event?: string; object?: { id?: string } };
  try {
    notification = JSON.parse(rawBody);
  } catch {
    logger.warn("Webhook body was not valid JSON", { sourceIp });
    return;
  }

  const providerPaymentId = notification.object?.id;
  const eventType = notification.event;
  if (!providerPaymentId || !eventType) {
    logger.warn("Webhook missing object.id or event", { sourceIp });
    return;
  }

  try {
    await prisma.paymentWebhookEvent.create({
      data: { providerPaymentId, eventType, payload: notification as never },
    });
  } catch {
    // Unique constraint violation: this exact event was already processed,
    // or a concurrent duplicate delivery is being handled right now. No-op.
    return;
  }

  const payment = await prisma.payment.findUnique({ where: { providerPaymentId } });
  if (!payment) {
    logger.warn("Webhook for unknown providerPaymentId", { providerPaymentId, eventType });
    return;
  }
  if (payment.status !== "pending") {
    // Already resolved by an earlier event (or the ledger insert above raced
    // it) — nothing further to do.
    return;
  }

  // The only line that matters: re-fetch authoritative status ourselves.
  let fetched;
  try {
    fetched = await paymentProvider.fetchPayment(providerPaymentId);
  } catch (err) {
    logger.error("Failed to re-fetch payment from YooKassa during webhook processing", {
      providerPaymentId,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (fetched.paid && fetched.status === "succeeded") {
    await activatePayment(payment, fetched.paymentMethodId);
  } else if (fetched.status === "canceled") {
    await markPaymentCanceled(payment);
  }
  // Any other re-fetched status (e.g. still "pending" / "waiting_for_capture")
  // is left as-is; a later webhook delivery will resolve it.
}
