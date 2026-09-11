import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { paymentProvider, activatePayment, markPaymentCanceled, PLAN_LABELS } from "./service.js";
import { sendBillingNotification } from "../notifications/service.js";
import { tn, PLAN_LABELS as I18N_PLAN_LABELS, type PastDueReason, type Lang } from "../../i18n/notifications.js";
import type { Subscription } from "@prisma/client";

/**
 * Invoked by scripts/chargeRenewals.ts on a schedule (cron / Yandex Cloud
 * Function trigger — not run in-process). Factored out of the script itself
 * so it can be exercised directly in tests against the fake PaymentProvider,
 * the same pattern used for every other billing code path in this codebase.
 */
export async function chargeDueRenewals(now: Date = new Date()): Promise<{ charged: number; pastDue: number; expired: number; canceled: number }> {
  let charged = 0, pastDue = 0, canceled = 0;

  const dueSubs = await prisma.subscription.findMany({
    where: { status: "active", currentPeriodEnd: { lte: now } },
  });

  for (const sub of dueSubs) {
    if (sub.cancelAtPeriodEnd) {
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: "canceled" } });
      await notify(sub, (lang) => tn(lang).subscriptionCanceled(I18N_PLAN_LABELS[lang][sub.plan]));
      canceled++;
      continue;
    }

    if (!sub.yookassaPaymentMethodId) {
      await markPastDue(sub, "no_saved_method");
      pastDue++;
      continue;
    }

    const outcome = await attemptRenewalCharge(sub);
    if (outcome === "charged") charged++;
    else pastDue++;
  }

  const expired = await expireStalePastDue(now);

  return { charged, pastDue, expired, canceled };
}

async function attemptRenewalCharge(sub: Subscription): Promise<"charged" | "past_due"> {
  // Deterministic per-billing-cycle idempotence key: stable across
  // overlapping renewal-job runs processing the SAME due subscription
  // (currentPeriodEnd only moves once a charge actually succeeds), so
  // ЮKassa's own idempotency window collapses concurrent attempts into one
  // real charge instead of two. A random key here was the actual
  // double-charge bug — this is the fix.
  const idempotenceKey = `renewal:${sub.id}:${sub.currentPeriodEnd!.toISOString()}`;
  let result;
  try {
    // Off-session charge against the saved method — ЮKassa charges directly,
    // no redirect/confirmation step. Unlike a webhook body, this response IS
    // trustworthy: it's the literal reply to our own authenticated HTTPS
    // request, not attacker-reachable input.
    result = await paymentProvider.createPayment({
      amountRub: sub.priceRub,
      description: `RuSmartOpt — продление подписки «${PLAN_LABELS[sub.plan]}»`,
      returnUrl: env.FRONTEND_BASE_URL,
      idempotenceKey,
      metadata: { subscriptionId: sub.id },
      paymentMethodId: sub.yookassaPaymentMethodId!,
    });
  } catch (err) {
    logger.error("Renewal charge request failed", { subscriptionId: sub.id, err: err instanceof Error ? err.message : String(err) });
    await markPastDue(sub, "charge_request_failed");
    return "past_due";
  }

  let payment;
  try {
    payment = await prisma.payment.create({
      data: {
        subscriptionId: sub.id,
        providerPaymentId: result.providerPaymentId,
        idempotenceKey,
        amountRub: sub.priceRub,
        purpose: "renewal",
        confirmationUrl: result.confirmationUrl,
      },
    });
  } catch (err) {
    // A concurrent renewal-job run for the same subscription+period won the
    // race: ЮKassa deduplicated the identical key to the same
    // providerPaymentId, and that run's insert landed first. Nothing left
    // for this run to do — the other run's outcome (charged/past_due) is
    // authoritative, and double-counting it here would inflate the job's
    // summary without any real second charge.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      logger.warn("Renewal charge already recorded by a concurrent run", { subscriptionId: sub.id, providerPaymentId: result.providerPaymentId });
      return "past_due";
    }
    throw err;
  }

  if (result.status === "succeeded") {
    await activatePayment(payment, sub.yookassaPaymentMethodId ?? undefined);
    return "charged";
  }
  if (result.status === "canceled") {
    await markPaymentCanceled(payment);
    await markPastDue(sub, "payment_declined");
    return "past_due";
  }
  // Still pending/waiting — leave the Payment row pending; the ЮKassa
  // webhook will resolve it (activatePayment / markPaymentCanceled), exactly
  // like the initial-checkout flow. Mark past_due in the meantime so the
  // paywall (if enforced) doesn't treat an unconfirmed renewal as active.
  await markPastDue(sub, "awaiting_confirmation");
  return "past_due";
}

async function markPastDue(sub: Subscription, reason: PastDueReason) {
  if (sub.status !== "past_due") {
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "past_due" } });
    await notify(sub, (lang) => tn(lang).subscriptionPastDue(I18N_PLAN_LABELS[lang][sub.plan], reason, env.PAST_DUE_GRACE_DAYS));
  }
}

/** past_due subscriptions that have sat unresolved past the grace window are marked expired. */
async function expireStalePastDue(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - env.PAST_DUE_GRACE_DAYS * 86400000);
  const stale = await prisma.subscription.findMany({ where: { status: "past_due", updatedAt: { lte: cutoff } } });
  for (const sub of stale) {
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "expired" } });
    await notify(sub, (lang) => tn(lang).subscriptionExpired(I18N_PLAN_LABELS[lang][sub.plan], env.PAST_DUE_GRACE_DAYS));
  }
  return stale.length;
}

async function notify(sub: Subscription, build: (lang: Lang) => string) {
  const company = await prisma.company.findUnique({ where: { id: sub.companyId } });
  if (company) await sendBillingNotification(company, build).catch(() => {});
}
