import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { env } from "../src/config/env.js";
import { app, resetDb, resetRateLimits, registerAndLogin, createActiveSubscription, CSRF } from "./helpers.js";

async function createDraftListing(cookie: string) {
  const res = await request(app).post("/api/listings").set(CSRF).set("Cookie", cookie).send({
    title: "Стеллаж торговый МГ-200",
    description: "Прочный складской стеллаж",
    category: "Мебель",
    price: 7200,
  });
  return res.body.id as string;
}

describe("paywall feature flag", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
    env.PAYWALL_ENFORCEMENT_ENABLED = false;
  });

  afterEach(() => {
    env.PAYWALL_ENFORCEMENT_ENABLED = false;
  });

  it("flag off (default): publish works with no subscription at all — unchanged from pre-billing behavior", async () => {
    const seller = await registerAndLogin(request, "s@zavod.ru", "supplier", "Завод");
    const listingId = await createDraftListing(seller.cookie);

    const res = await request(app).post(`/api/listings/${listingId}/publish`).set(CSRF).set("Cookie", seller.cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.published).toBe(true);
  });

  it("flag on: publishing without an active marketplace_full subscription is blocked with 402", async () => {
    env.PAYWALL_ENFORCEMENT_ENABLED = true;
    const seller = await registerAndLogin(request, "s2@zavod.ru", "supplier", "Завод 2");
    const listingId = await createDraftListing(seller.cookie);

    const res = await request(app).post(`/api/listings/${listingId}/publish`).set(CSRF).set("Cookie", seller.cookie).send({});
    expect(res.status).toBe(402);

    const own = await request(app).get(`/api/listings/${listingId}`).set("Cookie", seller.cookie);
    expect(own.body.published).toBe(false);
  });

  it("flag on: publishing succeeds once the seller has an active marketplace_full subscription", async () => {
    env.PAYWALL_ENFORCEMENT_ENABLED = true;
    const seller = await registerAndLogin(request, "s3@zavod.ru", "supplier", "Завод 3");
    await createActiveSubscription(seller.companyId);
    const listingId = await createDraftListing(seller.cookie);

    const res = await request(app).post(`/api/listings/${listingId}/publish`).set(CSRF).set("Cookie", seller.cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.published).toBe(true);
  });

  it("flag on: create, edit, unpublish, and delete are never gated by subscription status", async () => {
    env.PAYWALL_ENFORCEMENT_ENABLED = true;
    const seller = await registerAndLogin(request, "s4@zavod.ru", "supplier", "Завод 4");
    const listingId = await createDraftListing(seller.cookie); // create — unaffected

    const editRes = await request(app).patch(`/api/listings/${listingId}`).set(CSRF).set("Cookie", seller.cookie)
      .send({ price: 8000 });
    expect(editRes.status).toBe(200); // edit — unaffected

    // Grant a subscription just long enough to publish, then revoke it by
    // expiring the subscription — unpublish must still work with no active plan.
    await createActiveSubscription(seller.companyId);
    await request(app).post(`/api/listings/${listingId}/publish`).set(CSRF).set("Cookie", seller.cookie).send({});

    const unpublishRes = await request(app).post(`/api/listings/${listingId}/unpublish`).set(CSRF).set("Cookie", seller.cookie).send({});
    expect(unpublishRes.status).toBe(200);
    expect(unpublishRes.body.published).toBe(false); // unpublish — unaffected

    const deleteRes = await request(app).delete(`/api/listings/${listingId}`).set(CSRF).set("Cookie", seller.cookie);
    expect(deleteRes.status).toBe(204); // delete — unaffected
  });
});
