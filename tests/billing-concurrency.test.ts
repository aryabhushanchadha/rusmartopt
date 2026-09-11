import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { prisma } from "../src/db/prisma.js";
import { env } from "../src/config/env.js";
import { chargeDueRenewals } from "../src/modules/billing/renewalService.js";
import { processYookassaWebhook } from "../src/modules/billing/webhookService.js";
import { app, resetDb, resetRateLimits, registerAndLogin, fakeSetPaymentStatus, TRUSTED_TEST_IP, CSRF } from "./helpers.js";

/**
 * Regression tests for the double-charge / over-issue races a Payments &
 * Billing Engineer review found: concurrent renewal runs, concurrent
 * checkout double-clicks, a promo-slot race, and a webhook TOCTOU gap. Each
 * test simulates the race with Promise.all rather than just asserting the
 * end state of a single sequential call — a sequential call would pass even
 * on the old, buggy code.
 */
describe("billing concurrency / double-charge prevention", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("two overlapping renewal-job runs charge a due subscription exactly once", async () => {
    const supplier = await registerAndLogin(request, "s@zavod.ru", "supplier", "Завод");
    const sub = await prisma.subscription.create({
      data: {
        companyId: supplier.companyId,
        plan: "marketplace_full",
        status: "active",
        priceRub: 24999,
        currentPeriodStart: new Date(Date.now() - 31 * 86400000),
        currentPeriodEnd: new Date(Date.now() - 1000),
        yookassaPaymentMethodId: "fake_method_saved",
      },
    });

    // Two "cron" invocations racing, as would happen with overlapping
    // schedule triggers.
    await Promise.all([chargeDueRenewals(), chargeDueRenewals()]);

    const payments = await prisma.payment.findMany({ where: { subscriptionId: sub.id, purpose: "renewal" } });
    expect(payments).toHaveLength(1); // not two Payment rows for one billing cycle

    const providerIds = new Set(payments.map((p) => p.providerPaymentId));
    expect(providerIds.size).toBe(1); // and definitely not two distinct ЮKassa charges
  });

  it("two concurrent checkout requests (double-click) never open two ЮKassa sessions", async () => {
    const supplier = await registerAndLogin(request, "s2@zavod.ru", "supplier", "Завод 2");

    const [a, b] = await Promise.all([
      request(app).post("/api/billing/checkout").set(CSRF).set("Cookie", supplier.cookie).send({ plan: "software" }),
      request(app).post("/api/billing/checkout").set(CSRF).set("Cookie", supplier.cookie).send({ plan: "software" }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.confirmationUrl).toBe(b.body.confirmationUrl); // same ЮKassa session, not two

    const payRes = await request(app).get("/api/billing/payments").set("Cookie", supplier.cookie);
    expect(payRes.body).toHaveLength(1); // exactly one Payment row, not two
  });

  it("a canceled checkout attempt can be retried with a genuinely new charge", async () => {
    const supplier = await registerAndLogin(request, "s3@zavod.ru", "supplier", "Завод 3");
    const first = await request(app).post("/api/billing/checkout").set(CSRF).set("Cookie", supplier.cookie).send({ plan: "software" });
    const firstPayments = await request(app).get("/api/billing/payments").set("Cookie", supplier.cookie);
    fakeSetPaymentStatus(firstPayments.body[0].providerPaymentId, "canceled", false);
    await processYookassaWebhook(
      JSON.stringify({ event: "payment.canceled", object: { id: firstPayments.body[0].providerPaymentId } }),
      TRUSTED_TEST_IP
    );

    const second = await request(app).post("/api/billing/checkout").set(CSRF).set("Cookie", supplier.cookie).send({ plan: "software" });
    expect(second.status).toBe(200);
    expect(second.body.confirmationUrl).not.toBe(first.body.confirmationUrl); // a real new attempt, not blocked by the dead key

    const allPayments = await request(app).get("/api/billing/payments").set("Cookie", supplier.cookie);
    expect(allPayments.body).toHaveLength(2);
  });

  it("concurrent first-time signups near the promo boundary never over-issue the discount", async () => {
    env.PROMO_SLOTS = 3;
    try {
      const suppliers = await Promise.all(
        Array.from({ length: 6 }, (_, i) => registerAndLogin(request, `promo${i}@zavod.ru`, "supplier", `Завод ${i}`))
      );

      await Promise.all(
        suppliers.map((s) =>
          request(app).post("/api/billing/checkout").set(CSRF).set("Cookie", s.cookie).send({ plan: "marketplace_full" })
        )
      );

      const promoCount = await prisma.subscription.count({ where: { plan: "marketplace_full", isPromoPrice: true } });
      expect(promoCount).toBeLessThanOrEqual(3); // never more than PROMO_SLOTS, even under a concurrent race
    } finally {
      env.PROMO_SLOTS = 100;
    }
  });

  it("two different webhook event types for the same payment activate the subscription exactly once", async () => {
    const supplier = await registerAndLogin(request, "s4@zavod.ru", "supplier", "Завод 4");
    await request(app).post("/api/billing/checkout").set(CSRF).set("Cookie", supplier.cookie).send({ plan: "software" });
    const payRes = await request(app).get("/api/billing/payments").set("Cookie", supplier.cookie);
    const providerPaymentId = payRes.body[0].providerPaymentId;
    fakeSetPaymentStatus(providerPaymentId, "succeeded", true);

    // Two distinct event types for the same payment — the ledger's
    // (providerPaymentId, eventType) unique constraint does NOT dedupe these
    // against each other, so this exercises the atomic claim inside
    // activatePayment instead.
    await Promise.all([
      processYookassaWebhook(JSON.stringify({ event: "payment.waiting_for_capture", object: { id: providerPaymentId } }), TRUSTED_TEST_IP),
      processYookassaWebhook(JSON.stringify({ event: "payment.succeeded", object: { id: providerPaymentId } }), TRUSTED_TEST_IP),
    ]);

    const subRes = await request(app).get("/api/billing/subscription").set("Cookie", supplier.cookie);
    expect(subRes.body.subscription.status).toBe("active");

    const notifications = await prisma.notification.count();
    expect(notifications).toBeLessThanOrEqual(1); // activation side-effect fired at most once
  });
});
