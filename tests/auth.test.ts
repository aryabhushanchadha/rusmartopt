import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, resetDb, resetRateLimits, extractCookie } from "./helpers.js";

const CSRF = { "X-Requested-With": "rso-frontend" };

describe("auth", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("registers a supplier and returns a session cookie", async () => {
    const res = await request(app).post("/api/auth/register").set(CSRF).send({
      companyName: "Тест Завод",
      companyType: "supplier",
      city: "Москва",
      fullName: "Тест Тестов",
      email: "test@zavod.ru",
      password: "password123",
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("test@zavod.ru");
    expect(() => extractCookie(res)).not.toThrow();
  });

  it("rejects state-changing auth requests without the CSRF header", async () => {
    const res = await request(app).post("/api/auth/register").send({
      companyName: "Тест Завод", companyType: "supplier", fullName: "Тест Тестов",
      email: "nocsrf@zavod.ru", password: "password123",
    });
    expect(res.status).toBe(403);
  });

  it("rejects login with wrong password using a generic message", async () => {
    await request(app).post("/api/auth/register").set(CSRF).send({
      companyName: "Тест Завод", companyType: "supplier", fullName: "Тест Тестов",
      email: "test2@zavod.ru", password: "password123",
    });
    const res = await request(app).post("/api/auth/login").set(CSRF).send({ email: "test2@zavod.ru", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Неверная почта или пароль");
  });

  it("rejects login for a nonexistent user with the SAME generic message (no user enumeration)", async () => {
    const res = await request(app).post("/api/auth/login").set(CSRF).send({ email: "nobody@example.com", password: "whatever123" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Неверная почта или пароль");
  });

  it("rejects /me without a session", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("logs in and accesses /me with the resulting session", async () => {
    await request(app).post("/api/auth/register").set(CSRF).send({
      companyName: "Тест Завод", companyType: "supplier", fullName: "Тест Тестов",
      email: "test3@zavod.ru", password: "password123",
    });
    const loginRes = await request(app).post("/api/auth/login").set(CSRF).send({ email: "test3@zavod.ru", password: "password123" });
    const cookie = extractCookie(loginRes);
    const meRes = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe("test3@zavod.ru");
  });

  it("invalidates the session on logout", async () => {
    await request(app).post("/api/auth/register").set(CSRF).send({
      companyName: "Тест Завод", companyType: "supplier", fullName: "Тест Тестов",
      email: "test4@zavod.ru", password: "password123",
    });
    const loginRes = await request(app).post("/api/auth/login").set(CSRF).send({ email: "test4@zavod.ru", password: "password123" });
    const cookie = extractCookie(loginRes);
    await request(app).post("/api/auth/logout").set(CSRF).set("Cookie", cookie);
    const meRes = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(401);
  });

  it("defaults to Russian, and honors a chosen language at registration", async () => {
    const ruRes = await request(app).post("/api/auth/register").set(CSRF).send({
      companyName: "Завод По Умолчанию", companyType: "supplier", fullName: "Тест",
      email: "ru-default@zavod.ru", password: "password123",
    });
    expect(ruRes.body.user.language).toBe("ru");

    const enRes = await request(app).post("/api/auth/register").set(CSRF).send({
      companyName: "English Factory", companyType: "supplier", fullName: "Test User",
      email: "en@zavod.ru", password: "password123", language: "en",
    });
    expect(enRes.body.user.language).toBe("en");
  });

  it("lets a logged-in user switch their interface language, and it persists across sessions", async () => {
    await request(app).post("/api/auth/register").set(CSRF).send({
      companyName: "Завод Языка", companyType: "supplier", fullName: "Тест",
      email: "lang@zavod.ru", password: "password123",
    });
    const loginRes = await request(app).post("/api/auth/login").set(CSRF).send({ email: "lang@zavod.ru", password: "password123" });
    const cookie = extractCookie(loginRes);

    const patchRes = await request(app).patch("/api/auth/language").set(CSRF).set("Cookie", cookie).send({ language: "zh" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.user.language).toBe("zh");

    const meRes = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.body.user.language).toBe("zh");

    // A fresh login (new session) still sees the persisted choice — it's stored on the User row, not the session.
    const loginRes2 = await request(app).post("/api/auth/login").set(CSRF).send({ email: "lang@zavod.ru", password: "password123" });
    expect(loginRes2.body.user.language).toBe("zh");
  });

  it("rejects an unsupported language code", async () => {
    await request(app).post("/api/auth/register").set(CSRF).send({
      companyName: "Завод Валидации", companyType: "supplier", fullName: "Тест",
      email: "badlang@zavod.ru", password: "password123",
    });
    const loginRes = await request(app).post("/api/auth/login").set(CSRF).send({ email: "badlang@zavod.ru", password: "password123" });
    const cookie = extractCookie(loginRes);
    const res = await request(app).patch("/api/auth/language").set(CSRF).set("Cookie", cookie).send({ language: "fr" });
    expect(res.status).toBe(400);
  });
});
