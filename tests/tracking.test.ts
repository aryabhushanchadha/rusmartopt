import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, resetDb, resetRateLimits, registerAndLogin, CSRF } from "./helpers.js";

describe("public order tracking (security-critical)", () => {
  let orderCode: string;
  let publicTrackingToken: string;

  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();

    const supplier = await registerAndLogin(request, "s@zavod.ru", "supplier", "Завод");
    const createRes = await request(app).post("/api/orders").set(CSRF).set("Cookie", supplier.cookie).send({
      buyerCompanyName: "СтройДвор", product: "Профиль ПВХ", qty: 500, price: 250000,
      city: "Химки", phone: "+7 968 330-8814", notifyChannel: "sms",
      dueDate: new Date(Date.now() + 4 * 86400000).toISOString(),
    });
    orderCode = createRes.body.orderCode;
    publicTrackingToken = createRes.body.publicTrackingToken;
  });

  it("succeeds with the correct order code + last 4 phone digits", async () => {
    const res = await request(app).post("/api/track/lookup").send({ orderCode, phoneLast4: "8814" });
    expect(res.status).toBe(200);
    expect(res.body.product).toBe("Профиль ПВХ");
    expect(res.body.phone).toBeUndefined(); // never leak the full phone number
  });

  it("returns the identical generic message for wrong phone digits as for a nonexistent order code", async () => {
    const wrongPhone = await request(app).post("/api/track/lookup").send({ orderCode, phoneLast4: "0000" });
    const noSuchOrder = await request(app).post("/api/track/lookup").send({ orderCode: "ЗК-9999", phoneLast4: "0000" });
    expect(wrongPhone.status).toBe(404);
    expect(noSuchOrder.status).toBe(404);
    expect(wrongPhone.body.error).toBe(noSuchOrder.body.error);
  });

  it("locks out an order code after repeated failed attempts", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/track/lookup").send({ orderCode, phoneLast4: "0000" });
    }
    const res = await request(app).post("/api/track/lookup").send({ orderCode, phoneLast4: "8814" }); // correct digits, but locked out
    expect(res.status).toBe(429);
  });

  it("allows direct token-based lookup without a phone check", async () => {
    const res = await request(app).get(`/api/track/${publicTrackingToken}`);
    expect(res.status).toBe(200);
    expect(res.body.product).toBe("Профиль ПВХ");
  });

  it("returns 404 for a nonexistent tracking token", async () => {
    const res = await request(app).get("/api/track/not-a-real-token");
    expect(res.status).toBe(404);
  });
});
