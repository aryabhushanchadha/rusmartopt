import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { prisma } from "../src/db/prisma.js";
import { app, resetDb, resetRateLimits, registerAndLogin, CSRF, TRUSTED_TEST_IP, fakeSetPaymentStatus } from "./helpers.js";

async function checkoutAndGetPaymentId(cookie: string) {
  await request(app).post("/api/billing/checkout").set(CSRF).set("Cookie", cookie).send({ plan: "software" });
  const payRes = await request(app).get("/api/billing/payments").set("Cookie", cookie);
  return payRes.body[0].providerPaymentId as string;
}

async function deliverWebhook(providerPaymentId: string, ip: string, event = "payment.succeeded") {
  return request(app)
    .post("/api/billing/webhook/yookassa")
    .set("X-Forwarded-For", ip)
    .send({ event, object: { id: providerPaymentId } });
}

describe("billing webhook (security-critical)", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("activates ONLY when the re-fetched provider status confirms success — a webhook body claiming success alone is not enough", async () => {
    const supplier = await registerAndLogin(request, "s@zavod.ru", "supplier", "Завод");
    const providerPaymentId = await checkoutAndGetPaymentId(supplier.cookie);

    // Attacker (or a stale/malicious body) claims success in the POST body,
    // but the fake provider's re-fetchable status is still "pending" —
    // activation must NOT happen from the body alone.
    const res = await deliverWebhook(providerPaymentId, TRUSTED_TEST_IP, "payment.succeeded");
    expect(res.status).toBe(200);

    const subRes = await request(app).get("/api/billing/subscription").set("Cookie", supplier.cookie);
    expect(subRes.body.subscription.status).toBe("pending");
  });

  it("ignores a webhook delivered from a non-allowlisted IP, without ever calling fetchPayment or mutating anything", async () => {
    const supplier = await registerAndLogin(request, "s2@zavod.ru", "supplier", "Завод 2");
    const providerPaymentId = await checkoutAndGetPaymentId(supplier.cookie);
    fakeSetPaymentStatus(providerPaymentId, "succeeded", true);

    const res = await deliverWebhook(providerPaymentId, "8.8.8.8"); // not the trusted test IP
    expect(res.status).toBe(200); // still 200 (no retry-inducing error), but no side effects

    const subRes = await request(app).get("/api/billing/subscription").set("Cookie", supplier.cookie);
    expect(subRes.body.subscription.status).toBe("pending");

    const events = await prisma.paymentWebhookEvent.count();
    expect(events).toBe(0);
  });

  it("processes an identical event delivered twice exactly once (idempotency ledger)", async () => {
    const supplier = await registerAndLogin(request, "s3@zavod.ru", "supplier", "Завод 3");
    const providerPaymentId = await checkoutAndGetPaymentId(supplier.cookie);
    fakeSetPaymentStatus(providerPaymentId, "succeeded", true);

    await deliverWebhook(providerPaymentId, TRUSTED_TEST_IP);
    await deliverWebhook(providerPaymentId, TRUSTED_TEST_IP); // exact retry

    const events = await prisma.paymentWebhookEvent.count();
    expect(events).toBe(1);

    const notifications = await prisma.notification.count();
    expect(notifications).toBeLessThanOrEqual(1); // activation notification fires at most once
  });

  it("a webhook for an unknown providerPaymentId is logged and 200'd without a crash or any row mutation", async () => {
    const res = await deliverWebhook("does-not-exist", TRUSTED_TEST_IP);
    expect(res.status).toBe(200);
    const events = await prisma.paymentWebhookEvent.count();
    expect(events).toBe(1); // the ledger entry itself is still recorded — that's not a mutation of business state
    const subs = await prisma.subscription.count();
    expect(subs).toBe(0);
  });

  it("activates correctly once the re-fetched status genuinely confirms success", async () => {
    const supplier = await registerAndLogin(request, "s4@zavod.ru", "supplier", "Завод 4");
    const providerPaymentId = await checkoutAndGetPaymentId(supplier.cookie);
    fakeSetPaymentStatus(providerPaymentId, "succeeded", true, "fake_method_1");

    const res = await deliverWebhook(providerPaymentId, TRUSTED_TEST_IP);
    expect(res.status).toBe(200);

    const subRes = await request(app).get("/api/billing/subscription").set("Cookie", supplier.cookie);
    expect(subRes.body.subscription.status).toBe("active");

    const payRes = await request(app).get("/api/billing/payments").set("Cookie", supplier.cookie);
    expect(payRes.body[0].status).toBe("succeeded");
  });
});
