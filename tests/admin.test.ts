import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import argon2 from "argon2";
import { prisma } from "../src/db/prisma.js";
import { getDashboardMetrics } from "../src/modules/admin/service.js";
import { app, resetDb, resetRateLimits, registerAndLogin, createAdminAndLogin, createAndPublishListing, CSRF } from "./helpers.js";

describe("admin dashboard: access control", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("redirects an unauthenticated visitor to the login page instead of a raw JSON 401", async () => {
    const res = await request(app).get("/admin");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/admin/login");
  });

  it("shows a plain 403 page (not a login loop) for a logged-in non-admin", async () => {
    const supplier = await registerAndLogin(request, "s@zavod.ru", "supplier", "Завод");
    const res = await request(app).get("/admin").set("Cookie", supplier.cookie);
    expect(res.status).toBe(403);
    expect(res.text).toContain("Доступ запрещён");
  });

  it("serves the login form", async () => {
    const res = await request(app).get("/admin/login");
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/admin/login"');
  });

  it("logs an admin in via the HTML form and redirects to the dashboard", async () => {
    await prisma.user.create({
      data: {
        email: "root@rusmartopt.ru",
        passwordHash: await argon2.hash("rootpass123", { type: argon2.argon2id }),
        fullName: "Root",
        role: "admin",
      },
    });
    const res = await request(app)
      .post("/admin/login")
      .type("form")
      .send({ email: "root@rusmartopt.ru", password: "rootpass123" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/admin");
    expect(res.headers["set-cookie"]).toBeDefined();

    const cookie = res.headers["set-cookie"][0].split(";")[0];
    const dash = await request(app).get("/admin").set("Cookie", cookie);
    expect(dash.status).toBe(200);
  });

  it("rejects a correct password for a non-admin account trying the admin login form", async () => {
    await registerAndLogin(request, "notadmin@zavod.ru", "supplier", "Завод 2");
    const res = await request(app)
      .post("/admin/login")
      .type("form")
      .send({ email: "notadmin@zavod.ru", password: "password123" });
    expect(res.status).toBe(403);
    expect(res.text).toContain("Доступ только для администраторов");
  });

  it("renders a real HTML error page (not raw JSON) for a malformed login submission", async () => {
    const res = await request(app).post("/admin/login").type("form").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain('action="/admin/login"'); // still the login form, not a JSON blob
  });

  it("renders a real HTML error page (not raw JSON) once rate-limited, and never sets a session cookie while limited", async () => {
    let last;
    for (let i = 0; i < 21; i++) {
      last = await request(app).post("/admin/login").type("form").send({ email: "nobody@example.com", password: "wrong" });
    }
    expect(last!.status).toBe(429);
    expect(last!.headers["content-type"]).toMatch(/html/);
    expect(last!.headers["set-cookie"]).toBeUndefined();
  });

  it("a real admin sees the dashboard with real numbers", async () => {
    const supplier = await registerAndLogin(request, "s2@zavod.ru", "supplier", "Завод 3");
    await createAndPublishListing(request, supplier.cookie);
    const admin = await createAdminAndLogin(request, "admin@rusmartopt.ru");

    const res = await request(app).get("/admin").set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Метрики платформы");
    expect(res.text).toContain("Завод 3");
  });
});

describe("admin dashboard: metrics correctness", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("counts suppliers and buyers correctly", async () => {
    await registerAndLogin(request, "a@zavod.ru", "supplier", "Завод А");
    await registerAndLogin(request, "b@zavod.ru", "supplier", "Завод Б");
    await registerAndLogin(request, "c@stroydvor.ru", "buyer", "СтройДвор");

    const metrics = await getDashboardMetrics();
    expect(metrics.companies.totalSuppliers).toBe(2);
    expect(metrics.companies.totalBuyers).toBe(1);
    expect(metrics.companies.total).toBe(3);
  });

  it("buckets today's signups into today's slot in the 30-day series (Moscow calendar day, not UTC)", async () => {
    await registerAndLogin(request, "a2@zavod.ru", "supplier", "Завод А2");
    const metrics = await getDashboardMetrics();
    // Dashboard buckets by Moscow-local date (fixed UTC+3, no DST) — a plain
    // UTC toISOString() key would intermittently disagree with the real
    // bucket between 21:00-23:59 UTC (00:00-02:59 Moscow, next calendar day).
    const todayKey = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    const todayBucket = metrics.companies.dailySuppliers.find((d) => d.date === todayKey);
    expect(todayBucket?.count).toBe(1);
  });

  it("attributes a signup just after Moscow midnight to the correct day even when that's still 'yesterday' in UTC", async () => {
    const supplier = await registerAndLogin(request, "a2b@zavod.ru", "supplier", "Завод А2Б");
    // 01:30 Moscow time on a fixed date == 22:30 UTC the day before.
    const moscowMidnightPlus90 = new Date("2026-06-15T01:30:00+03:00");
    await prisma.company.update({ where: { id: supplier.companyId }, data: { createdAt: moscowMidnightPlus90 } });
    const metrics = await getDashboardMetrics(new Date("2026-06-15T12:00:00+03:00"));
    const bucket = metrics.companies.dailySuppliers.find((d) => d.date === "2026-06-15");
    expect(bucket?.count).toBe(1);
    const prevDayBucket = metrics.companies.dailySuppliers.find((d) => d.date === "2026-06-14");
    expect(prevDayBucket?.count).toBe(0);
  });

  it("tracks the seller funnel: registered -> listed -> published -> subscribed", async () => {
    const onlyRegistered = await registerAndLogin(request, "reg@zavod.ru", "supplier", "Только регистрация");
    void onlyRegistered;
    const withDraft = await registerAndLogin(request, "draft@zavod.ru", "supplier", "С черновиком");
    await request(app).post("/api/listings").set(CSRF).set("Cookie", withDraft.cookie).send({ title: "Черновик" });
    const withPublished = await registerAndLogin(request, "pub@zavod.ru", "supplier", "С публикацией");
    await createAndPublishListing(request, withPublished.cookie);
    const withSub = await registerAndLogin(request, "sub@zavod.ru", "supplier", "С подпиской");
    await prisma.subscription.create({
      data: { companyId: withSub.companyId, plan: "software", status: "active", priceRub: 10000, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 2592000000) },
    });

    const metrics = await getDashboardMetrics();
    expect(metrics.sellerFunnel.totalSuppliers).toBe(4);
    expect(metrics.sellerFunnel.withListing).toBe(2); // draft + published
    expect(metrics.sellerFunnel.withPublishedListing).toBe(1);
    expect(metrics.sellerFunnel.withActiveSubscription).toBe(1);
  });

  it("computes billing revenue only from succeeded payments, never pending or canceled ones", async () => {
    const supplier = await registerAndLogin(request, "billing@zavod.ru", "supplier", "Завод Биллинг");
    const sub = await prisma.subscription.create({
      data: { companyId: supplier.companyId, plan: "software", status: "active", priceRub: 10000, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 2592000000) },
    });
    await prisma.payment.create({ data: { subscriptionId: sub.id, providerPaymentId: "p1", idempotenceKey: "k1", amountRub: 10000, purpose: "initial", status: "succeeded", paidAt: new Date() } });
    await prisma.payment.create({ data: { subscriptionId: sub.id, providerPaymentId: "p2", idempotenceKey: "k2", amountRub: 10000, purpose: "renewal", status: "pending" } });
    await prisma.payment.create({ data: { subscriptionId: sub.id, providerPaymentId: "p3", idempotenceKey: "k3", amountRub: 24999, purpose: "renewal", status: "canceled" } });

    const metrics = await getDashboardMetrics();
    expect(metrics.billing.revenueRub).toBe(10000);
    expect(metrics.billing.paymentsToday).toBe(1);
  });

  it("recent signups list is capped and ordered newest-first", async () => {
    for (let i = 0; i < 5; i++) await registerAndLogin(request, `s${i}@zavod.ru`, "supplier", `Завод ${i}`);
    const metrics = await getDashboardMetrics();
    expect(metrics.recentSignups[0].name).toBe("Завод 4");
    expect(metrics.recentSignups).toHaveLength(5);
  });
});
