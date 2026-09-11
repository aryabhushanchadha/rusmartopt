import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, resetDb, resetRateLimits, registerAndLogin, createAndPublishListing, CSRF } from "./helpers.js";

describe("listings", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("lets a supplier create, list, and read their own listing", async () => {
    const supplier = await registerAndLogin(request, "s@zavod.ru", "supplier", "Завод");
    const createRes = await request(app).post("/api/listings").set(CSRF).set("Cookie", supplier.cookie).send({
      title: "Короб гофро 400×300", price: 55, category: "Упаковка",
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.slug).toBe("korob-gofro-400-300");
    expect(createRes.body.published).toBe(false);

    const listRes = await request(app).get("/api/listings").set("Cookie", supplier.cookie);
    expect(listRes.body).toHaveLength(1);
  });

  it("rejects listing creation from a buyer account", async () => {
    const buyer = await registerAndLogin(request, "b@stroydvor.ru", "buyer", "СтройДвор");
    const res = await request(app).post("/api/listings").set(CSRF).set("Cookie", buyer.cookie).send({ title: "X" });
    expect(res.status).toBe(403);
  });

  it("prevents supplier B from reading, editing, or deleting supplier A's listing (404, not 403)", async () => {
    const supplierA = await registerAndLogin(request, "a@zavodA.ru", "supplier", "Завод А");
    const supplierB = await registerAndLogin(request, "b@zavodB.ru", "supplier", "Завод Б");

    const createRes = await request(app).post("/api/listings").set(CSRF).set("Cookie", supplierA.cookie).send({ title: "Профиль ПВХ" });
    const id = createRes.body.id;

    const readRes = await request(app).get(`/api/listings/${id}`).set("Cookie", supplierB.cookie);
    expect(readRes.status).toBe(404);

    const editRes = await request(app).patch(`/api/listings/${id}`).set(CSRF).set("Cookie", supplierB.cookie).send({ title: "Hacked" });
    expect(editRes.status).toBe(404);

    const deleteRes = await request(app).delete(`/api/listings/${id}`).set(CSRF).set("Cookie", supplierB.cookie);
    expect(deleteRes.status).toBe(404);

    const publishRes = await request(app).post(`/api/listings/${id}/publish`).set(CSRF).set("Cookie", supplierB.cookie).send({});
    expect(publishRes.status).toBe(404);

    // owner can still read it fine
    const ownerRead = await request(app).get(`/api/listings/${id}`).set("Cookie", supplierA.cookie);
    expect(ownerRead.status).toBe(200);
  });

  it("rejects a negative price and a non-https image URL", async () => {
    const supplier = await registerAndLogin(request, "s2@zavod.ru", "supplier", "Завод 2");
    const badPrice = await request(app).post("/api/listings").set(CSRF).set("Cookie", supplier.cookie).send({ title: "X", price: -5 });
    expect(badPrice.status).toBe(400);
    const badImage = await request(app).post("/api/listings").set(CSRF).set("Cookie", supplier.cookie).send({ title: "X", imageUrl: "http://insecure.example/a.jpg" });
    expect(badImage.status).toBe(400);
  });

  it("lazily assigns a company slug on first publish", async () => {
    const supplier = await registerAndLogin(request, "s3@zavod.ru", "supplier", "МебельГрад Тест");
    const before = await request(app).get("/api/companies/me").set("Cookie", supplier.cookie);
    expect(before.body.slug).toBeNull();

    await createAndPublishListing(request, supplier.cookie);

    const after = await request(app).get("/api/companies/me").set("Cookie", supplier.cookie);
    expect(after.body.slug).toBe("mebelgrad-test");
  });

  it("unpublish flips published without touching the slug", async () => {
    const supplier = await registerAndLogin(request, "s4@zavod.ru", "supplier", "Завод 4");
    const { id, slug } = await createAndPublishListing(request, supplier.cookie);

    const unpub = await request(app).post(`/api/listings/${id}/unpublish`).set(CSRF).set("Cookie", supplier.cookie).send({});
    expect(unpub.status).toBe(200);
    expect(unpub.body.published).toBe(false);
    expect(unpub.body.slug).toBe(slug);
  });

  it("assigns -2 suffix when two listings from the same seller share a title", async () => {
    const supplier = await registerAndLogin(request, "s5@zavod.ru", "supplier", "Завод 5");
    const first = await request(app).post("/api/listings").set(CSRF).set("Cookie", supplier.cookie).send({ title: "Дверь" });
    const second = await request(app).post("/api/listings").set(CSRF).set("Cookie", supplier.cookie).send({ title: "Дверь" });
    expect(first.body.slug).toBe("dver");
    expect(second.body.slug).toBe("dver-2");
  });
});
