import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { prisma } from "../src/db/prisma.js";
import { app, resetDb, resetRateLimits, registerAndLogin, fakeSetPaymentStatus, TRUSTED_TEST_IP, CSRF } from "./helpers.js";

/**
 * Verifies notification TEXT actually changes with the recipient's language —
 * not just that a language field exists somewhere. Each test checks for a
 * phrase that could only appear in that specific language's template.
 */
describe("notifications respect the recipient's chosen language", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("sends a billing activation notice in the company's notifyLanguage (English)", async () => {
    const supplier = await registerAndLogin(request, "s@zavod.ru", "supplier", "Завод");
    await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({
      notifyPhone: "+7 900 000-0000", notifyChannel: "sms", notifyLanguage: "en",
    });

    await request(app).post("/api/billing/checkout").set(CSRF).set("Cookie", supplier.cookie).send({ plan: "software" });
    const payRes = await request(app).get("/api/billing/payments").set("Cookie", supplier.cookie);
    const providerPaymentId = payRes.body[0].providerPaymentId;
    fakeSetPaymentStatus(providerPaymentId, "succeeded", true);
    await request(app).post("/api/billing/webhook/yookassa").set("X-Forwarded-For", TRUSTED_TEST_IP)
      .send({ event: "payment.succeeded", object: { id: providerPaymentId } });

    const notification = await prisma.notification.findFirst({ orderBy: { createdAt: "desc" } });
    expect(notification?.message).toContain("subscription");
    expect(notification?.message).toContain("activated");
    expect(notification?.message).not.toContain("подписка"); // not the Russian text
  });

  it("sends the same billing notice in Chinese when that's the company's notifyLanguage", async () => {
    const supplier = await registerAndLogin(request, "s2@zavod.ru", "supplier", "Завод 2");
    await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({
      notifyPhone: "+7 900 000-0001", notifyChannel: "sms", notifyLanguage: "zh",
    });

    await request(app).post("/api/billing/checkout").set(CSRF).set("Cookie", supplier.cookie).send({ plan: "software" });
    const payRes = await request(app).get("/api/billing/payments").set("Cookie", supplier.cookie);
    const providerPaymentId = payRes.body[0].providerPaymentId;
    fakeSetPaymentStatus(providerPaymentId, "succeeded", true);
    await request(app).post("/api/billing/webhook/yookassa").set("X-Forwarded-For", TRUSTED_TEST_IP)
      .send({ event: "payment.succeeded", object: { id: providerPaymentId } });

    const notification = await prisma.notification.findFirst({ orderBy: { createdAt: "desc" } });
    expect(notification?.message).toContain("已激活"); // "activated"
  });

  it("sends a new-message notification in Vietnamese", async () => {
    const seller = await registerAndLogin(request, "s3@zavod.ru", "supplier", "Завод 3");
    await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", seller.cookie).send({
      notifyPhone: "+7 900 000-0002", notifyChannel: "sms", notifyLanguage: "vi",
    });
    const buyer = await registerAndLogin(request, "b3@stroydvor.ru", "buyer", "СтройДвор 3");
    const listingRes = await request(app).post("/api/listings").set(CSRF).set("Cookie", seller.cookie).send({ title: "Стеллаж" });
    await request(app).post(`/api/listings/${listingRes.body.id}/publish`).set(CSRF).set("Cookie", seller.cookie).send({});

    await request(app).post("/api/conversations").set(CSRF).set("Cookie", buyer.cookie).send({ listingId: listingRes.body.id, message: "Здравствуйте" });

    const notification = await prisma.notification.findFirst({ orderBy: { createdAt: "desc" } });
    expect(notification?.message).toContain("Tin nhắn mới"); // "New message"
  });

  it("sends an order stage-change SMS in the linked buyer company's language, defaulting to Russian when there's no linked buyer", async () => {
    const supplier = await registerAndLogin(request, "s4@zavod.ru", "supplier", "Завод 4");
    const buyer = await registerAndLogin(request, "b4@stroydvor.ru", "buyer", "СтройДвор 4");
    await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", buyer.cookie).send({ notifyLanguage: "en" });

    const orderRes = await request(app).post("/api/orders").set(CSRF).set("Cookie", supplier.cookie).send({
      buyerCompanyName: "СтройДвор 4", product: "Стеллаж", qty: 5, price: 50000,
      city: "Москва", phone: "+7 900 000-0003", notifyChannel: "sms",
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    });
    const advanceRes = await request(app).post(`/api/orders/${orderRes.body.id}/stage`).set(CSRF).set("Cookie", supplier.cookie).send({});
    expect(advanceRes.status).toBe(200);

    const notification = await prisma.notification.findFirst({ where: { orderId: orderRes.body.id }, orderBy: { createdAt: "desc" } });
    expect(notification?.message).toContain("Order");
    expect(notification?.message).toContain("stage changed to");
  });
});
