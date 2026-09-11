import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, resetDb, resetRateLimits, registerAndLogin, CSRF } from "./helpers.js";

/**
 * Cross-tenant isolation is the single most important correctness property in
 * this system — a bug here is a real data-exposure incident, not a UX defect.
 */
describe("tenant isolation", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("prevents supplier B from reading supplier A's order, and does not confirm it exists (404, not 403)", async () => {
    const supplierA = await registerAndLogin(request, "a@zavodA.ru", "supplier", "Завод А");
    const supplierB = await registerAndLogin(request, "b@zavodB.ru", "supplier", "Завод Б");

    const createRes = await request(app).post("/api/orders").set(CSRF).set("Cookie", supplierA.cookie).send({
      buyerCompanyName: "СтройДвор",
      product: "Стеллаж торговый МГ-200",
      qty: 10,
      price: 100000,
      city: "Москва",
      phone: "+7 916 402-8871",
      notifyChannel: "sms",
      dueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
    });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.id;

    const crossTenantRes = await request(app).get(`/api/orders/${orderId}`).set("Cookie", supplierB.cookie);
    expect(crossTenantRes.status).toBe(404);

    const ownerRes = await request(app).get(`/api/orders/${orderId}`).set("Cookie", supplierA.cookie);
    expect(ownerRes.status).toBe(200);
  });

  it("prevents supplier B from advancing supplier A's order stage", async () => {
    const supplierA = await registerAndLogin(request, "a2@zavodA.ru", "supplier", "Завод А2");
    const supplierB = await registerAndLogin(request, "b2@zavodB.ru", "supplier", "Завод Б2");

    const createRes = await request(app).post("/api/orders").set(CSRF).set("Cookie", supplierA.cookie).send({
      buyerCompanyName: "СтройДвор", product: "Короб гофро", qty: 100, price: 5000,
      city: "Москва", phone: "+7 926 774-6013", notifyChannel: "sms",
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
    });
    const orderId = createRes.body.id;

    const advanceRes = await request(app).post(`/api/orders/${orderId}/stage`).set(CSRF).set("Cookie", supplierB.cookie).send({});
    expect(advanceRes.status).toBe(404);
  });

  it("only lists orders belonging to the authenticated supplier's own company", async () => {
    const supplierA = await registerAndLogin(request, "a3@zavodA.ru", "supplier", "Завод А3");
    const supplierB = await registerAndLogin(request, "b3@zavodB.ru", "supplier", "Завод Б3");

    await request(app).post("/api/orders").set(CSRF).set("Cookie", supplierA.cookie).send({
      buyerCompanyName: "X", product: "P1", qty: 1, price: 1, city: "Москва",
      phone: "+7 900 000-0001", notifyChannel: "sms", dueDate: new Date(Date.now() + 86400000).toISOString(),
    });
    await request(app).post("/api/orders").set(CSRF).set("Cookie", supplierB.cookie).send({
      buyerCompanyName: "Y", product: "P2", qty: 1, price: 1, city: "Москва",
      phone: "+7 900 000-0002", notifyChannel: "sms", dueDate: new Date(Date.now() + 86400000).toISOString(),
    });

    const listA = await request(app).get("/api/orders").set("Cookie", supplierA.cookie);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].product).toBe("P1");
  });

  it("links a new order to a buyer's account when the buyer company name matches an existing registered buyer", async () => {
    const supplier = await registerAndLogin(request, "sup@zavod.ru", "supplier", "Завод Поставщик");
    const buyer = await registerAndLogin(request, "buy@stroydvor.ru", "buyer", "СтройДвор");

    await request(app).post("/api/orders").set(CSRF).set("Cookie", supplier.cookie).send({
      buyerCompanyName: "СтройДвор", product: "Стеллаж", qty: 5, price: 50000,
      city: "Химки", phone: "+7 900 000-0003", notifyChannel: "sms",
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    });

    const buyerOrders = await request(app).get("/api/orders").set("Cookie", buyer.cookie);
    expect(buyerOrders.status).toBe(200);
    expect(buyerOrders.body).toHaveLength(1);
    expect(buyerOrders.body[0].product).toBe("Стеллаж");
  });

  it("backfills orders created before the matching buyer registered", async () => {
    const supplier = await registerAndLogin(request, "sup2@zavod.ru", "supplier", "Завод Поставщик 2");

    // Order created for "ГофроПак" before that company has any account.
    await request(app).post("/api/orders").set(CSRF).set("Cookie", supplier.cookie).send({
      buyerCompanyName: "ГофроПак", product: "Короб", qty: 100, price: 10000,
      city: "Москва", phone: "+7 900 000-0004", notifyChannel: "sms",
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    });

    // Buyer registers afterward — the pre-existing order should retroactively link.
    const buyer = await registerAndLogin(request, "buy2@gofropak.ru", "buyer", "ГофроПак");
    const buyerOrders = await request(app).get("/api/orders").set("Cookie", buyer.cookie);
    expect(buyerOrders.body).toHaveLength(1);
    expect(buyerOrders.body[0].product).toBe("Короб");
  });
});
