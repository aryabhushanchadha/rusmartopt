import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, resetDb, resetRateLimits, registerAndLogin, CSRF } from "./helpers.js";

/**
 * The seller-journey audit flagged this as the one part of the core
 * dashboard flow (shipping/production) with zero test coverage, breaking
 * this project's own stated discipline of testing every endpoint against a
 * real Postgres/Redis instance. Fills that gap.
 */
async function createOrderAtSupplier(supplierCookie: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app).post("/api/orders").set(CSRF).set("Cookie", supplierCookie).send({
    buyerCompanyName: "СтройДвор", product: "Стеллаж торговый МГ-200", qty: 10, price: 100000,
    city: "Москва", phone: "+7 916 402-8871", notifyChannel: "sms",
    dueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
    ...overrides,
  });
  return res.body;
}

async function advanceToStage(supplierCookie: string, orderId: string, times: number) {
  let last;
  for (let i = 0; i < times; i++) {
    last = await request(app).post(`/api/orders/${orderId}/stage`).set(CSRF).set("Cookie", supplierCookie).send({});
  }
  return last!.body;
}

describe("order shipping and production endpoints", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("lets a supplier ship an order directly (skipping to stage 7), generating a tracking number if none is given", async () => {
    const supplier = await registerAndLogin(request, "s@zavod.ru", "supplier", "Завод");
    const order = await createOrderAtSupplier(supplier.cookie);

    const res = await request(app).post(`/api/orders/${order.id}/ship`).set(CSRF).set("Cookie", supplier.cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe(7);
    expect(res.body.shipStage).toBe(0);
    expect(res.body.trackingNumber).toMatch(/^ZH-\d+$/);
  });

  it("lets a supplier ship with an explicit tracking number", async () => {
    const supplier = await registerAndLogin(request, "s2@zavod.ru", "supplier", "Завод 2");
    const order = await createOrderAtSupplier(supplier.cookie);

    const res = await request(app).post(`/api/orders/${order.id}/ship`).set(CSRF).set("Cookie", supplier.cookie).send({ trackingNumber: "ZH-12345678" });
    expect(res.status).toBe(200);
    expect(res.body.trackingNumber).toBe("ZH-12345678");
  });

  it("forbids a buyer from shipping an order", async () => {
    const supplier = await registerAndLogin(request, "s3@zavod.ru", "supplier", "Завод 3");
    const buyer = await registerAndLogin(request, "b3@stroydvor.ru", "buyer", "СтройДвор");
    const order = await createOrderAtSupplier(supplier.cookie, { buyerCompanyName: "СтройДвор" });

    const res = await request(app).post(`/api/orders/${order.id}/ship`).set(CSRF).set("Cookie", buyer.cookie).send({});
    expect(res.status).toBe(403);
  });

  it("404s shipping a cross-tenant order (not owned by the requesting supplier)", async () => {
    const supplierA = await registerAndLogin(request, "a4@zavod.ru", "supplier", "Завод А4");
    const supplierB = await registerAndLogin(request, "b4@zavod.ru", "supplier", "Завод Б4");
    const order = await createOrderAtSupplier(supplierA.cookie);

    const res = await request(app).post(`/api/orders/${order.id}/ship`).set(CSRF).set("Cookie", supplierB.cookie).send({});
    expect(res.status).toBe(404);
  });

  it("advances ship-stage only once an order has actually been shipped (stage 7)", async () => {
    const supplier = await registerAndLogin(request, "s5@zavod.ru", "supplier", "Завод 5");
    const order = await createOrderAtSupplier(supplier.cookie);

    const tooEarly = await request(app).patch(`/api/orders/${order.id}/ship-stage`).set(CSRF).set("Cookie", supplier.cookie).send({ shipStage: 1 });
    expect(tooEarly.status).toBe(409);

    await request(app).post(`/api/orders/${order.id}/ship`).set(CSRF).set("Cookie", supplier.cookie).send({});
    const res = await request(app).patch(`/api/orders/${order.id}/ship-stage`).set(CSRF).set("Cookie", supplier.cookie).send({ shipStage: 2 });
    expect(res.status).toBe(200);
    expect(res.body.shipStage).toBe(2);
  });

  it("rejects a ship-stage value outside the valid range", async () => {
    const supplier = await registerAndLogin(request, "s6@zavod.ru", "supplier", "Завод 6");
    const order = await createOrderAtSupplier(supplier.cookie);
    await request(app).post(`/api/orders/${order.id}/ship`).set(CSRF).set("Cookie", supplier.cookie).send({});

    const res = await request(app).patch(`/api/orders/${order.id}/ship-stage`).set(CSRF).set("Cookie", supplier.cookie).send({ shipStage: 99 });
    expect(res.status).toBe(400);
  });

  it("records a real stage-change log entry per transition, tenant-scoped", async () => {
    const supplier = await registerAndLogin(request, "s7@zavod.ru", "supplier", "Завод 7");
    const otherSupplier = await registerAndLogin(request, "s7b@zavod.ru", "supplier", "Завод 7Б");
    const order = await createOrderAtSupplier(supplier.cookie);
    await advanceToStage(supplier.cookie, order.id, 2);

    const log = await request(app).get(`/api/orders/${order.id}/log`).set("Cookie", supplier.cookie);
    expect(log.status).toBe(200);
    expect(log.body).toHaveLength(2);
    expect(log.body[0].toStage).toBe(1);
    expect(log.body[1].toStage).toBe(2);

    const crossTenant = await request(app).get(`/api/orders/${order.id}/log`).set("Cookie", otherSupplier.cookie);
    expect(crossTenant.status).toBe(404);
  });

  it("lets a supplier manually notify the buyer, recording a real Notification row", async () => {
    const supplier = await registerAndLogin(request, "s8@zavod.ru", "supplier", "Завод 8");
    const order = await createOrderAtSupplier(supplier.cookie);

    const res = await request(app).post(`/api/orders/${order.id}/notify`).set(CSRF).set("Cookie", supplier.cookie).send({});
    expect(res.status).toBe(200);

    const notifications = await request(app).get(`/api/orders/${order.id}/notifications`).set("Cookie", supplier.cookie);
    expect(notifications.status).toBe(200);
    expect(notifications.body.length).toBeGreaterThanOrEqual(1);
    expect(notifications.body[0].orderId).toBe(order.id);
  });

  it("forbids a buyer from triggering a manual notification", async () => {
    const supplier = await registerAndLogin(request, "s9@zavod.ru", "supplier", "Завод 9");
    const buyer = await registerAndLogin(request, "b9@stroydvor.ru", "buyer", "СтройДвор9");
    const order = await createOrderAtSupplier(supplier.cookie, { buyerCompanyName: "СтройДвор9" });

    const res = await request(app).post(`/api/orders/${order.id}/notify`).set(CSRF).set("Cookie", buyer.cookie).send({});
    expect(res.status).toBe(403);
  });

  it("a linked buyer can read the order log and notification history for their own order", async () => {
    const supplier = await registerAndLogin(request, "s10@zavod.ru", "supplier", "Завод 10");
    const buyer = await registerAndLogin(request, "b10@stroydvor.ru", "buyer", "СтройДвор10");
    const order = await createOrderAtSupplier(supplier.cookie, { buyerCompanyName: "СтройДвор10" });
    await advanceToStage(supplier.cookie, order.id, 1);

    const log = await request(app).get(`/api/orders/${order.id}/log`).set("Cookie", buyer.cookie);
    expect(log.status).toBe(200);
    expect(log.body.length).toBeGreaterThanOrEqual(1);

    const notifications = await request(app).get(`/api/orders/${order.id}/notifications`).set("Cookie", buyer.cookie);
    expect(notifications.status).toBe(200);
  });
});
