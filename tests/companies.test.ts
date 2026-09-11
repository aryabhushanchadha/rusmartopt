import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, resetDb, resetRateLimits, registerAndLogin, CSRF } from "./helpers.js";

describe("company profile", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("returns the full profile a seller registered with", async () => {
    const supplier = await registerAndLogin(request, "s@zavod.ru", "supplier", "Завод");
    const res = await request(app).get("/api/companies/me").set("Cookie", supplier.cookie);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Завод");
    expect(res.body.type).toBe("supplier");
    expect(res.body.city).toBe("Москва"); // registerAndLogin's default
  });

  it("lets a seller edit industry, city, and INN after registration — previously stuck at whatever was typed at signup", async () => {
    const supplier = await registerAndLogin(request, "s2@zavod.ru", "supplier", "Завод 2");
    const res = await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({
      industry: "Металлообработка",
      city: "Подольск",
      inn: "7701234567",
    });
    expect(res.status).toBe(200);
    expect(res.body.industry).toBe("Металлообработка");
    expect(res.body.city).toBe("Подольск");
    expect(res.body.inn).toBe("7701234567");

    const me = await request(app).get("/api/companies/me").set("Cookie", supplier.cookie);
    expect(me.body.industry).toBe("Металлообработка");
  });

  it("defaults notifyLanguage to Russian and lets a seller change it", async () => {
    const supplier = await registerAndLogin(request, "s3b@zavod.ru", "supplier", "Завод Три Б");
    const before = await request(app).get("/api/companies/me").set("Cookie", supplier.cookie);
    expect(before.body.notifyLanguage).toBe("ru");

    const res = await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({ notifyLanguage: "vi" });
    expect(res.status).toBe(200);
    expect(res.body.notifyLanguage).toBe("vi");
  });

  it("lets a seller edit description, website, logo, and notification settings together", async () => {
    const supplier = await registerAndLogin(request, "s3@zavod.ru", "supplier", "Завод 3");
    const res = await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({
      description: "Производство мебели с 2010 года",
      website: "https://zavod3.example",
      logoUrl: "https://zavod3.example/logo.png",
      notifyPhone: "+7 900 000-0000",
      notifyChannel: "telegram",
    });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe("Производство мебели с 2010 года");
    expect(res.body.notifyChannel).toBe("telegram");
  });

  it("clears a previously-set field when the client sends null (not just leaves it unchanged)", async () => {
    const supplier = await registerAndLogin(request, "s3c@zavod.ru", "supplier", "Завод Три В");
    await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({
      website: "https://zavod3c.example",
      notifyPhone: "+7 900 000-0009",
      notifyChannel: "sms",
    });

    const cleared = await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({
      website: null,
      notifyPhone: null,
      notifyChannel: null,
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.website).toBeNull();
    expect(cleared.body.notifyPhone).toBeNull();
    expect(cleared.body.notifyChannel).toBeNull();

    // Omitting a key still means "leave unchanged" — clearing one field doesn't touch another.
    const untouched = await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({ description: "still here" });
    expect(untouched.body.description).toBe("still here");
    expect(untouched.body.website).toBeNull();
  });

  it("rejects a non-https logo or website URL", async () => {
    const supplier = await registerAndLogin(request, "s4@zavod.ru", "supplier", "Завод 4");
    const res = await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({
      website: "http://insecure.example",
    });
    expect(res.status).toBe(400);
  });

  it("assigns a public slug on first profile save, so the seller's public page becomes reachable", async () => {
    const supplier = await registerAndLogin(request, "s5@zavod.ru", "supplier", "Завод Пять");
    const before = await request(app).get("/api/companies/me").set("Cookie", supplier.cookie);
    expect(before.body.slug).toBeNull();

    await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({ description: "Hello" });

    const after = await request(app).get("/api/companies/me").set("Cookie", supplier.cookie);
    expect(after.body.slug).toBeTruthy();
  });

  it("a buyer can view their own profile the same way a supplier does", async () => {
    const buyer = await registerAndLogin(request, "b@stroydvor.ru", "buyer", "СтройДвор");
    const res = await request(app).get("/api/companies/me").set("Cookie", buyer.cookie);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("buyer");
  });

  it("an unauthenticated request is rejected", async () => {
    const res = await request(app).get("/api/companies/me");
    expect(res.status).toBe(401);
  });
});
