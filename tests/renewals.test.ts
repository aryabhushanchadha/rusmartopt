import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { env } from "../src/config/env.js";
import { chargeDueRenewals } from "../src/modules/billing/renewalService.js";
import { resetDb, fakeSetPaymentStatus } from "./helpers.js";

async function createCompany(name: string) {
  return prisma.company.create({ data: { name, type: "supplier", city: "Москва" } });
}

async function createDueSubscription(companyId: string, overrides: Partial<{
  status: "active" | "past_due";
  cancelAtPeriodEnd: boolean;
  yookassaPaymentMethodId: string | null;
  periodEndOffsetMs: number;
  updatedAtOffsetMs: number;
}> = {}) {
  const periodEnd = new Date(Date.now() - (overrides.periodEndOffsetMs ?? 1000)); // due by default
  const sub = await prisma.subscription.create({
    data: {
      companyId,
      plan: "marketplace_full",
      status: overrides.status ?? "active",
      priceRub: 24999,
      currentPeriodStart: new Date(periodEnd.getTime() - 30 * 86400000),
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
      yookassaPaymentMethodId: overrides.yookassaPaymentMethodId === undefined ? "fake_method_saved" : overrides.yookassaPaymentMethodId,
    },
  });
  if (overrides.updatedAtOffsetMs) {
    // Simulate a past_due transition that happened N ms ago, bypassing @updatedAt's now() default.
    await prisma.$executeRawUnsafe(
      `UPDATE subscriptions SET updated_at = $1 WHERE id = $2`,
      new Date(Date.now() - overrides.updatedAtOffsetMs),
      sub.id
    );
  }
  return sub;
}

describe("renewal cycle", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cancels a subscription whose period ended with cancelAtPeriodEnd set, without attempting a charge", async () => {
    const company = await createCompany("Завод 1");
    await createDueSubscription(company.id, { cancelAtPeriodEnd: true });

    const result = await chargeDueRenewals();
    expect(result.canceled).toBe(1);
    expect(result.charged).toBe(0);

    const sub = await prisma.subscription.findUnique({ where: { companyId: company.id } });
    expect(sub!.status).toBe("canceled");
  });

  it("marks past_due (no charge attempt) when there is no saved payment method", async () => {
    const company = await createCompany("Завод 2");
    await createDueSubscription(company.id, { yookassaPaymentMethodId: null });

    const result = await chargeDueRenewals();
    expect(result.pastDue).toBe(1);

    const sub = await prisma.subscription.findUnique({ where: { companyId: company.id } });
    expect(sub!.status).toBe("past_due");
    const payments = await prisma.payment.count({ where: { subscriptionId: sub!.id } });
    expect(payments).toBe(0);
  });

  it("charges the saved method and extends the period by ~30 days on success", async () => {
    const company = await createCompany("Завод 3");
    const sub = await createDueSubscription(company.id);
    // The fake provider's createPayment always returns status "pending" —
    // simulate ЮKassa confirming synchronously by pre-seeding the id it will
    // mint (fake_payment_1, since resetDb() resets the counter) as succeeded
    // is not possible ahead of time, so instead assert the pending path here
    // and the synchronous-success path via the payment id after creation.
    void sub;

    const result = await chargeDueRenewals();
    expect(result.pastDue).toBe(1); // fake provider returns "pending" synchronously, same as a real off-session charge that settles async

    const updated = await prisma.subscription.findUnique({ where: { companyId: company.id } });
    expect(updated!.status).toBe("past_due");
    const payment = await prisma.payment.findFirst({ where: { subscriptionId: updated!.id } });
    expect(payment!.purpose).toBe("renewal");
    expect(payment!.status).toBe("pending");

    // The webhook later confirms success, same as the initial-checkout flow.
    fakeSetPaymentStatus(payment!.providerPaymentId, "succeeded", true);
    const { processYookassaWebhook } = await import("../src/modules/billing/webhookService.js");
    const { TRUSTED_TEST_IP } = await import("./helpers.js");
    await processYookassaWebhook(JSON.stringify({ event: "payment.succeeded", object: { id: payment!.providerPaymentId } }), TRUSTED_TEST_IP);

    const reactivated = await prisma.subscription.findUnique({ where: { companyId: company.id } });
    expect(reactivated!.status).toBe("active");
    expect(reactivated!.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);
  });

  it("expires a subscription that has sat past_due beyond the grace window", async () => {
    const company = await createCompany("Завод 4");
    await createDueSubscription(company.id, {
      status: "past_due",
      updatedAtOffsetMs: (env.PAST_DUE_GRACE_DAYS + 1) * 86400000,
    });

    const result = await chargeDueRenewals();
    expect(result.expired).toBe(1);

    const sub = await prisma.subscription.findUnique({ where: { companyId: company.id } });
    expect(sub!.status).toBe("expired");
  });

  it("leaves a past_due subscription alone if the grace window has not yet elapsed", async () => {
    const company = await createCompany("Завод 5");
    await createDueSubscription(company.id, {
      status: "past_due",
      updatedAtOffsetMs: 1000, // just went past_due
    });

    const result = await chargeDueRenewals();
    expect(result.expired).toBe(0);

    const sub = await prisma.subscription.findUnique({ where: { companyId: company.id } });
    expect(sub!.status).toBe("past_due");
  });

  it("does not touch subscriptions whose period has not ended yet", async () => {
    const company = await createCompany("Завод 6");
    await createDueSubscription(company.id, { periodEndOffsetMs: -30 * 86400000 }); // ends in the future

    const result = await chargeDueRenewals();
    expect(result.charged + result.pastDue + result.canceled).toBe(0);

    const sub = await prisma.subscription.findUnique({ where: { companyId: company.id } });
    expect(sub!.status).toBe("active");
  });
});
