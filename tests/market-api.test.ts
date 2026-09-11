import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, resetDb, resetRateLimits, registerAndLogin, createAndPublishListing, CSRF } from "./helpers.js";

/**
 * JSON counterpart to tests/market-public.test.ts, covering the same
 * scenarios against /api/market/* instead of the EJS-rendered /postavshiki
 * pages — both surfaces share the exact same service-layer queries
 * (src/modules/market/service.ts), so this suite mainly proves the new
 * routing/serialization layer doesn't diverge from the already-tested logic.
 */
describe("public marketplace JSON API (/api/market)", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("returns a published listing with the expected fields", async () => {
    const supplier = await registerAndLogin(request, "s@zavod.ru", "supplier", "МебельГрад");
    const { slug, companySlug } = await createAndPublishListing(request, supplier.cookie, {
      title: "Стеллаж торговый МГ-200",
      description: "Прочный складской стеллаж",
      price: 7200,
    });

    const res = await request(app).get(`/api/market/companies/${companySlug}/listings/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.listing.title).toBe("Стеллаж торговый МГ-200");
    expect(res.body.listing.description).toBe("Прочный складской стеллаж");
    expect(res.body.listing.price).toBe(7200);
    expect(res.body.company.name).toBe("МебельГрад");
    expect(res.body.company.slug).toBe(companySlug);
  });

  it("404s for an unpublished listing", async () => {
    const supplier = await registerAndLogin(request, "s2@zavod.ru", "supplier", "Завод 2");
    const createRes = await request(app).post("/api/listings").set(CSRF).set("Cookie", supplier.cookie).send({ title: "Черновик" });
    const res = await request(app).get(`/api/market/companies/zavod-2/listings/${createRes.body.slug}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it("404s for a nonexistent company slug", async () => {
    const res = await request(app).get("/api/market/companies/no-such-company/listings/whatever");
    expect(res.status).toBe(404);
  });

  it("404s a company profile that has a slug but zero published listings (thin-content rule, same as the HTML route)", async () => {
    const supplier = await registerAndLogin(request, "s3@zavod.ru", "supplier", "Завод 3");
    await request(app).post("/api/listings").set(CSRF).set("Cookie", supplier.cookie).send({ title: "Неопубликовано" });
    await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({ description: "Test" });
    const me = await request(app).get("/api/companies/me").set("Cookie", supplier.cookie);
    expect(me.body.slug).toBeTruthy();

    const res = await request(app).get(`/api/market/companies/${me.body.slug}`);
    expect(res.status).toBe(404);
  });

  it("returns a company profile with its published listings once it has at least one", async () => {
    const supplier = await registerAndLogin(request, "s4@zavod.ru", "supplier", "Завод 4");
    const { companySlug } = await createAndPublishListing(request, supplier.cookie, { title: "Стеллаж торговый МГ-200" });

    const res = await request(app).get(`/api/market/companies/${companySlug}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Завод 4");
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.listings[0].title).toBe("Стеллаж торговый МГ-200");
  });

  it("never leaks a draft listing alongside published ones on the company profile", async () => {
    const supplier = await registerAndLogin(request, "s4b@zavod.ru", "supplier", "Завод 4Б");
    const { companySlug } = await createAndPublishListing(request, supplier.cookie, { title: "Опубликовано" });
    await request(app).post("/api/listings").set(CSRF).set("Cookie", supplier.cookie).send({ title: "Черновик" });

    const res = await request(app).get(`/api/market/companies/${companySlug}`);
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.listings[0].title).toBe("Опубликовано");
  });

  it("returns raw (unescaped) strings — JSON has no HTML-escaping concern, escaping is the client's job", async () => {
    const supplier = await registerAndLogin(request, "s5@zavod.ru", "supplier", "Завод 5");
    const { slug, companySlug } = await createAndPublishListing(request, supplier.cookie, {
      title: "XSS<script>alert(1)</script>Test",
      description: 'desc with "quotes" and <img src=x onerror=alert(2)>',
    });
    const res = await request(app).get(`/api/market/companies/${companySlug}/listings/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.listing.title).toBe("XSS<script>alert(1)</script>Test");
    expect(res.body.listing.description).toBe('desc with "quotes" and <img src=x onerror=alert(2)>');
  });

  it("paginates the catalog at the existing PAGE_SIZE (24), with correct total/totalPages", async () => {
    const supplier = await registerAndLogin(request, "s6@zavod.ru", "supplier", "Завод 6");
    for (let i = 0; i < 25; i++) {
      await createAndPublishListing(request, supplier.cookie, { title: `Товар ${i}`, price: 1000 + i });
    }

    const page1 = await request(app).get("/api/market");
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(24);
    expect(page1.body.total).toBe(25);
    expect(page1.body.pageSize).toBe(24);
    expect(page1.body.totalPages).toBe(2);
    expect(page1.body.page).toBe(1);

    const page2 = await request(app).get("/api/market?page=2");
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.page).toBe(2);
  });

  it("clamps an out-of-range or garbage page number instead of erroring", async () => {
    const supplier = await registerAndLogin(request, "s7@zavod.ru", "supplier", "Завод 7");
    await createAndPublishListing(request, supplier.cookie);

    const tooHigh = await request(app).get("/api/market?page=999");
    expect(tooHigh.status).toBe(200);
    expect(tooHigh.body.items).toHaveLength(0);

    const garbage = await request(app).get("/api/market?page=not-a-number");
    expect(garbage.status).toBe(200);
    expect(garbage.body.page).toBe(1);
    expect(garbage.body.items).toHaveLength(1);
  });

  it("requires no CSRF header — these are unauthenticated, read-only GETs, same as /api/track", async () => {
    const supplier = await registerAndLogin(request, "s8@zavod.ru", "supplier", "Завод 8");
    await createAndPublishListing(request, supplier.cookie);
    // Deliberately NOT setting the X-Requested-With header, and no cookie either.
    const res = await request(app).get("/api/market");
    expect(res.status).toBe(200);
  });
});
