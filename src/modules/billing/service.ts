import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { yookassaProvider } from "./yookassa.js";
import { sendBillingNotification } from "../notifications/service.js";
import { tn, PLAN_LABELS as I18N_PLAN_LABELS } from "../../i18n/notifications.js";
import type { SessionData } from "../auth/session.js";
import type { SubscriptionPlan, Payment, Subscription } from "@prisma/client";
import type { PaymentProvider } from "./provider.js";

/**
 * Swappable at test time only — production code path always resolves to
 * yookassaProvider. webhookService.ts imports this same reference so tests
 * can exercise the full checkout->webhook flow against a fake provider
 * without ever calling the real ЮKassa API.
 */
export let paymentProvider: PaymentProvider = yookassaProvider;
export function __setPaymentProviderForTesting(provider: PaymentProvider) {
  paymentProvider = provider;
}

function requireSupplier(user: SessionData): string {
  if (user.role !== "supplier" || !user.companyId) {
    throw new HttpError(403, "Только поставщик может управлять подпиской");
  }
  return user.companyId;
}

export const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  software: "ПО для производства",
  marketplace_full: "Маркетплейс + ПО",
};

/** Promo price applies only to marketplace_full, for the first PROMO_SLOTS subscriptions ever to claim it. */
async function computePrice(
  tx: Prisma.TransactionClient,
  plan: SubscriptionPlan
): Promise<{ priceRub: number; isPromoPrice: boolean }> {
  if (plan === "software") return { priceRub: env.SOFTWARE_PRICE_RUB, isPromoPrice: false };
  const claimed = await tx.subscription.count({ where: { plan: "marketplace_full", isPromoPrice: true } });
  if (claimed < env.PROMO_SLOTS) return { priceRub: env.PROMO_PRICE_RUB, isPromoPrice: true };
  return { priceRub: env.MARKETPLACE_PRICE_RUB, isPromoPrice: false };
}

/**
 * The count-then-create in computePrice is a classic write-skew hazard: two
 * concurrent signups landing on the last promo slot can both read
 * claimed<PROMO_SLOTS as true and both get the discount. SERIALIZABLE
 * isolation makes Postgres itself detect that conflict and abort the loser
 * with a P2034, which ensureSubscription (below) retries once against
 * freshly-read state — so at most PROMO_SLOTS rows ever end up isPromoPrice.
 */
async function ensureSubscriptionOnce(companyId: string, plan: SubscriptionPlan): Promise<Subscription> {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.subscription.findUnique({ where: { companyId } });
      if (!existing) {
        const { priceRub, isPromoPrice } = await computePrice(tx, plan);
        return tx.subscription.create({ data: { companyId, plan, priceRub, isPromoPrice } });
      }
      if (existing.status === "active" || existing.status === "past_due") {
        // Reuse as-is — plan/price changes on an already-paying subscription
        // are a fast-follow (proration etc.), not handled in this first version.
        return existing;
      }
      // pending / canceled / expired: safe to (re)point at a freshly chosen plan.
      const { priceRub, isPromoPrice } = await computePrice(tx, plan);
      return tx.subscription.update({ where: { companyId }, data: { plan, priceRub, isPromoPrice } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

async function ensureSubscription(companyId: string, plan: SubscriptionPlan): Promise<Subscription> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await ensureSubscriptionOnce(companyId, plan);
    } catch (err) {
      const isSerializationConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
      if (!isSerializationConflict || attempt === MAX_ATTEMPTS) throw err;
      // Standard response to a Postgres serialization failure: retry against
      // freshly-read state. A short jittered backoff avoids every loser in a
      // burst immediately re-colliding with the others.
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
    }
  }
  throw new Error("unreachable");
}

export async function createCheckout(user: SessionData, plan: SubscriptionPlan): Promise<{ confirmationUrl: string }> {
  const companyId = requireSupplier(user);
  const sub = await ensureSubscription(companyId, plan);
  if (sub.status === "active") {
    throw new HttpError(409, "У вас уже есть активная подписка");
  }

  // Double-click / duplicate-tab guard, cheapest layer: reuse an
  // already-open checkout instead of opening a second ЮKassa session.
  const existingPending = await prisma.payment.findFirst({
    where: { subscriptionId: sub.id, status: "pending", purpose: "initial" },
    orderBy: { createdAt: "desc" },
  });
  if (existingPending?.confirmationUrl) {
    return { confirmationUrl: existingPending.confirmationUrl };
  }

  // Deterministic per-attempt idempotence key: stable across concurrent
  // retries of the SAME attempt (ЮKassa's own idempotency window collapses
  // them into one charge — see fetchPayment's docs on Idempotence-Key), but
  // a fresh key once a previous attempt has actually resolved, so a genuine
  // new purchase attempt isn't blocked forever by an old canceled payment.
  const attemptNumber = await prisma.payment.count({ where: { subscriptionId: sub.id, purpose: "initial" } });
  const idempotenceKey = `checkout:${sub.id}:${attemptNumber}`;

  const result = await paymentProvider.createPayment({
    amountRub: sub.priceRub,
    description: `RuSmartOpt — ${PLAN_LABELS[sub.plan]}`,
    returnUrl: `${env.FRONTEND_BASE_URL}/?billing_return=1`,
    idempotenceKey,
    metadata: { subscriptionId: sub.id },
    savePaymentMethod: true,
  });

  if (!result.confirmationUrl) {
    throw new HttpError(500, "ЮKassa не вернула ссылку на оплату");
  }

  try {
    await prisma.payment.create({
      data: {
        subscriptionId: sub.id,
        providerPaymentId: result.providerPaymentId,
        idempotenceKey,
        amountRub: sub.priceRub,
        purpose: "initial",
        confirmationUrl: result.confirmationUrl,
      },
    });
  } catch (err) {
    // A concurrent request computed the identical (subscriptionId,
    // attemptNumber) key, ЮKassa deduplicated it to the same
    // providerPaymentId, and that request's insert won the race — reuse its
    // row rather than erroring or opening a second session.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.payment.findUnique({ where: { providerPaymentId: result.providerPaymentId } });
      if (existing?.confirmationUrl) return { confirmationUrl: existing.confirmationUrl };
    }
    throw err;
  }

  return { confirmationUrl: result.confirmationUrl };
}

export async function getOwnSubscription(user: SessionData) {
  const companyId = requireSupplier(user);
  const sub = await prisma.subscription.findUnique({ where: { companyId } });
  return { subscription: sub };
}

export async function cancelSubscription(user: SessionData) {
  const companyId = requireSupplier(user);
  const sub = await prisma.subscription.findUnique({ where: { companyId } });
  if (!sub || sub.status !== "active") {
    throw new HttpError(409, "Нет активной подписки для отмены");
  }
  return prisma.subscription.update({ where: { companyId }, data: { cancelAtPeriodEnd: true } });
}

export async function getOwnPayments(user: SessionData): Promise<Payment[]> {
  const companyId = requireSupplier(user);
  const sub = await prisma.subscription.findUnique({ where: { companyId } });
  if (!sub) return [];
  return prisma.payment.findMany({ where: { subscriptionId: sub.id }, orderBy: { createdAt: "desc" } });
}

export async function getPromoStatus() {
  const claimed = await prisma.subscription.count({ where: { plan: "marketplace_full", isPromoPrice: true } });
  return { claimed, total: env.PROMO_SLOTS };
}

/** Used by listings/service.ts's paywall gate (§5 of the plan) — the only other module that touches billing state. */
export async function hasActiveMarketplaceSubscription(companyId: string): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({ where: { companyId } });
  return Boolean(sub && sub.status === "active" && sub.plan === "marketplace_full");
}

/**
 * Called from webhookService.ts after a re-fetched, provider-attested
 * payment confirms success. Never called from the webhook body directly.
 *
 * The `updateMany({..., status: "pending"})` claim is the real idempotency
 * guard, not the caller's earlier `payment.status !== "pending"` read —
 * that read-then-act check is a TOCTOU gap (two different event types for
 * the same payment can both pass it before either has written anything).
 * Only the request whose conditional update actually matches a row (count
 * === 1) proceeds to extend the subscription and send a notification; a
 * concurrent duplicate sees count === 0 and no-ops.
 */
export async function activatePayment(payment: Payment, paymentMethodId: string | undefined) {
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 86400000);
  const updated = await prisma.$transaction(async (tx) => {
    const claim = await tx.payment.updateMany({
      where: { id: payment.id, status: "pending" },
      data: { status: "succeeded", paidAt: now },
    });
    if (claim.count === 0) return null; // already resolved by a concurrent call
    return tx.subscription.update({
      where: { id: payment.subscriptionId },
      data: {
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        ...(paymentMethodId ? { yookassaPaymentMethodId: paymentMethodId } : {}),
      },
    });
  });
  if (!updated) return undefined;
  const company = await prisma.company.findUnique({ where: { id: updated.companyId } });
  if (company) {
    await sendBillingNotification(company, (lang) => tn(lang).subscriptionActivated(I18N_PLAN_LABELS[lang][updated.plan])).catch(() => {});
  }
  return updated;
}

export async function markPaymentCanceled(payment: Payment) {
  await prisma.payment.updateMany({ where: { id: payment.id, status: "pending" }, data: { status: "canceled" } });
}
