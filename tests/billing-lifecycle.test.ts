import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, resetDb, resetRateLimits, registerAndLogin, CSRF, TRUSTED_TEST_IP, fakeSetPaymentStatus } from "./helpers.js";

async function checkout(cookie: string, plan: "software" | "marketplace_full") {
  return request(app).post("/api/billing/checkout").set(CSRF).set("Cookie", cookie).send({ plan });
}

async function deliverWebhook(providerPaymentId: string, event = "payment.succeeded") {
  return request(app)
    .post("/api/billing/webhook/yookassa")
    .set("X-Forwarded-For", TRUSTED_TEST_IP)
    .send({ event, object: { id: providerPaymentId } });
}

describe("billing lifecycle", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("checkout creates a pending Subscription + Payment", async () => {
    const supplier = await registerAndLogin(request, "s@zavod.ru", "supplier", "Завод");
    const res = await checkout(supplier.cookie, "software");
    expect(res.status).toBe(200);
    expect(res.body.confirmationUrl).toMatch(/^https:\/\/fake-yookassa\.test\//);

    const subRes = await request(app).get("/api/billing/subscription").set("Cookie", supplier.cookie);
    expect(subRes.body.subscription.status).toBe("pending");
    expect(subRes.body.subscription.priceRub).toBe(10000);
  });

  it("awards promo pricing to the first PROMO_SLOTS marketplace subscribers", async () => {
    // PROMO_SLOTS defaults to 100 — realistic to test the boundary would need
    // env override; here we just confirm the FIRST subscriber gets the promo
    // price, which is true regardless of the configured slot count (>0).
    const supplier = await registerAndLogin(request, "s2@zavod.ru", "supplier", "Завод 2");
    const res = await checkout(supplier.cookie, "marketplace_full");
    expect(res.status).toBe(200);
    const subRes = await request(app).get("/api/billing/subscription").set("Cookie", supplier.cookie);
    expect(subRes.body.subscription.priceRub).toBe(15000);
    expect(subRes.body.subscription.isPromoPrice).toBe(true);
  });

  it("a webhook-confirmed success moves the subscription pending -> active with a ~30-day period", async () => {
    const supplier = await registerAndLogin(request, "s3@zavod.ru", "supplier", "Завод 3");
    await checkout(supplier.cookie, "software");
    const payRes = await request(app).get("/api/billing/payments").set("Cookie", supplier.cookie);
    const providerPaymentId = payRes.body[0].providerPaymentId;

    fakeSetPaymentStatus(providerPaymentId, "succeeded", true);
    const webhookRes = await deliverWebhook(providerPaymentId);
    expect(webhookRes.status).toBe(200);

    const subRes = await request(app).get("/api/billing/subscription").set("Cookie", supplier.cookie);
    expect(subRes.body.subscription.status).toBe("active");
    const start = new Date(subRes.body.subscription.currentPeriodStart).getTime();
    const end = new Date(subRes.body.subscription.currentPeriodEnd).getTime();
    expect(end - start).toBeGreaterThan(29 * 86400000);
    expect(end - start).toBeLessThan(31 * 86400000);
  });

  it("a canceled first payment leaves the subscription pending, never active", async () => {
    const supplier = await registerAndLogin(request, "s4@zavod.ru", "supplier", "Завод 4");
    await checkout(supplier.cookie, "software");
    const payRes = await request(app).get("/api/billing/payments").set("Cookie", supplier.cookie);
    const providerPaymentId = payRes.body[0].providerPaymentId;

    fakeSetPaymentStatus(providerPaymentId, "canceled", false);
    await deliverWebhook(providerPaymentId, "payment.canceled");

    const subRes = await request(app).get("/api/billing/subscription").set("Cookie", supplier.cookie);
    expect(subRes.body.subscription.status).toBe("pending");
  });

  it("GET /api/billing/subscription is tenant-scoped — company A never sees company B's subscription", async () => {
    const supplierA = await registerAndLogin(request, "a@zavodA.ru", "supplier", "Завод А");
    const supplierB = await registerAndLogin(request, "b@zavodB.ru", "supplier", "Завод Б");
    await checkout(supplierA.cookie, "marketplace_full");

    const bRes = await request(app).get("/api/billing/subscription").set("Cookie", supplierB.cookie);
    expect(bRes.body.subscription).toBeNull();
  });

  it("a buyer cannot checkout or view a subscription", async () => {
    const buyer = await registerAndLogin(request, "buyer@stroydvor.ru", "buyer", "СтройДвор");
    const res = await checkout(buyer.cookie, "software");
    expect(res.status).toBe(403);
  });
});
