import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, resetDb, resetRateLimits, registerAndLogin, createAndPublishListing, CSRF } from "./helpers.js";

describe("public marketplace pages (SSR + SEO)", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("renders a published listing with correct title, description, canonical, OG, and JSON-LD", async () => {
    const supplier = await registerAndLogin(request, "s@zavod.ru", "supplier", "МебельГрад");
    const { slug, companySlug } = await createAndPublishListing(request, supplier.cookie, {
      title: "Стеллаж торговый МГ-200",
      description: "Прочный складской стеллаж",
      price: 7200,
    });

    const res = await request(app).get(`/postavshiki/${companySlug}/${slug}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>Стеллаж торговый МГ-200 — МебельГрад | RuSmartOpt</title>");
    expect(res.text).toContain('name="description" content="Прочный складской стеллаж"');
    expect(res.text).toContain(`<link rel="canonical" href="http://localhost:3000/postavshiki/${companySlug}/${slug}">`);
    expect(res.text).toContain('property="og:title"');
    expect(res.text).toContain('"@type":"Product"');
    expect(res.text).toContain('"@type":"BreadcrumbList"');
  });

  it("404s for an unpublished listing", async () => {
    const supplier = await registerAndLogin(request, "s2@zavod.ru", "supplier", "Завод 2");
    const createRes = await request(app).post("/api/listings").set(CSRF).set("Cookie", supplier.cookie).send({ title: "Черновик" });
    // never published
    const res = await request(app).get(`/postavshiki/zavod-2/${createRes.body.slug}`);
    expect(res.status).toBe(404);
  });

  it("404s for a nonexistent company slug", async () => {
    const res = await request(app).get("/postavshiki/no-such-company/whatever");
    expect(res.status).toBe(404);
  });

  it("404s a company profile page that has a slug but zero published listings (avoids thin content)", async () => {
    const supplier = await registerAndLogin(request, "s3@zavod.ru", "supplier", "Завод 3");
    await request(app).post("/api/listings").set(CSRF).set("Cookie", supplier.cookie).send({ title: "Неопубликовано" });
    // Trigger slug assignment via a profile save, WITHOUT publishing anything —
    // exercises the company.listings.length===0 branch specifically, not just "no slug yet".
    await request(app).patch("/api/companies/me").set(CSRF).set("Cookie", supplier.cookie).send({ description: "Test" });
    const me = await request(app).get("/api/companies/me").set("Cookie", supplier.cookie);
    expect(me.body.slug).toBeTruthy();

    const res = await request(app).get(`/postavshiki/${me.body.slug}`);
    expect(res.status).toBe(404);
  });

  it("shows a company profile page once it has at least one published listing", async () => {
    const supplier = await registerAndLogin(request, "s4@zavod.ru", "supplier", "Завод 4");
    const { companySlug } = await createAndPublishListing(request, supplier.cookie);
    const res = await request(app).get(`/postavshiki/${companySlug}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('"@type":"Organization"');
  });

  it("escapes XSS payloads in title/description everywhere on the rendered page (regular HTML and JSON-LD)", async () => {
    const supplier = await registerAndLogin(request, "s5@zavod.ru", "supplier", "Завод 5");
    const { slug, companySlug } = await createAndPublishListing(request, supplier.cookie, {
      title: "XSS<script>alert(1)</script>Test",
      description: 'desc with "quotes" and <img src=x onerror=alert(2)>',
    });
    const res = await request(app).get(`/postavshiki/${companySlug}/${slug}`);
    expect(res.status).toBe(200);
    // never a live <script>alert tag or unescaped onerror attribute
    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).not.toContain("<img src=x onerror=alert(2)>");
    expect(res.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // JSON-LD escapes "<" as < so the payload can't break out of the script tag
    expect(res.text).toContain('\\u003cscript>alert(1)\\u003c/script>');
  });

  it("sitemap.xml includes only published listings and excludes drafts", async () => {
    const supplier = await registerAndLogin(request, "s6@zavod.ru", "supplier", "Завод 6");
    const { slug, companySlug } = await createAndPublishListing(request, supplier.cookie, { title: "Опубликовано" });
    await request(app).post("/api/listings").set(CSRF).set("Cookie", supplier.cookie).send({ title: "Черновик 2" });

    const res = await request(app).get("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/xml/);
    expect(res.text).toContain(`/postavshiki/${companySlug}/${slug}`);
    expect(res.text).not.toContain("chernovik");
  });

  it("robots.txt disallows /api/ and references the sitemap", async () => {
    const res = await request(app).get("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Disallow: /api/");
    expect(res.text).toContain("Sitemap: http://localhost:3000/sitemap.xml");
  });

  it("shows no fake 'request sent' affordance on a listing page", async () => {
    const supplier = await registerAndLogin(request, "s7@zavod.ru", "supplier", "Завод 7");
    const { slug, companySlug } = await createAndPublishListing(request, supplier.cookie);
    const res = await request(app).get(`/postavshiki/${companySlug}/${slug}`);
    expect(res.text).not.toMatch(/запрос отправлен/i);
    expect(res.text).not.toMatch(/поставщик получил/i);
  });

  it("paginates the catalog at 24 per page, with a correct page-2 canonical URL", async () => {
    const supplier = await registerAndLogin(request, "s8@zavod.ru", "supplier", "Завод 8");
    for (let i = 0; i < 25; i++) {
      await createAndPublishListing(request, supplier.cookie, { title: `Товар ${i}`, price: 1000 + i });
    }

    const page1 = await request(app).get("/postavshiki");
    expect(page1.status).toBe(200);
    expect((page1.text.match(/class="tile"/g) || []).length).toBe(24);
    expect(page1.text).toContain('href="/postavshiki?page=2"');
    expect(page1.text).toContain('<link rel="canonical" href="http://localhost:3000/postavshiki">');

    const page2 = await request(app).get("/postavshiki?page=2");
    expect(page2.status).toBe(200);
    expect((page2.text.match(/class="tile"/g) || []).length).toBe(1); // the 25th listing
    expect(page2.text).toContain('<link rel="canonical" href="http://localhost:3000/postavshiki?page=2">');
  });

  it("clamps an out-of-range or garbage page number instead of erroring", async () => {
    const supplier = await registerAndLogin(request, "s9@zavod.ru", "supplier", "Завод 9");
    await createAndPublishListing(request, supplier.cookie);

    const tooHigh = await request(app).get("/postavshiki?page=999");
    expect(tooHigh.status).toBe(200); // past the last real page — empty catalog, not an error

    const garbage = await request(app).get("/postavshiki?page=not-a-number");
    expect(garbage.status).toBe(200); // falls back to page 1, not a crash
    expect((garbage.text.match(/class="tile"/g) || []).length).toBe(1);
  });
});
