import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, resetDb, resetRateLimits, registerAndLogin, createAndPublishListing, CSRF } from "./helpers.js";

describe("messaging", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
  });

  it("a buyer can start a thread on a published listing and the seller sees it in their inbox", async () => {
    const seller = await registerAndLogin(request, "seller@zavod.ru", "supplier", "Завод");
    const buyer = await registerAndLogin(request, "buyer@stroydvor.ru", "buyer", "СтройДвор");
    const listing = await createAndPublishListing(request, seller.cookie);

    const startRes = await request(app)
      .post("/api/conversations")
      .set(CSRF)
      .set("Cookie", buyer.cookie)
      .send({ listingId: listing.id, message: "Здравствуйте, есть в наличии 50 штук?" });
    expect(startRes.status).toBe(201);
    expect(startRes.body.messages).toHaveLength(1);

    const sellerInbox = await request(app).get("/api/conversations").set("Cookie", seller.cookie);
    expect(sellerInbox.body).toHaveLength(1);
    expect(sellerInbox.body[0].unread).toBe(1);

    const buyerInbox = await request(app).get("/api/conversations").set("Cookie", buyer.cookie);
    expect(buyerInbox.body).toHaveLength(1);
  });

  it("re-contacting the same listing continues the existing thread rather than creating a duplicate", async () => {
    const seller = await registerAndLogin(request, "seller2@zavod.ru", "supplier", "Завод 2");
    const buyer = await registerAndLogin(request, "buyer2@stroydvor.ru", "buyer", "СтройДвор 2");
    const listing = await createAndPublishListing(request, seller.cookie);

    const first = await request(app).post("/api/conversations").set(CSRF).set("Cookie", buyer.cookie)
      .send({ listingId: listing.id, message: "Первое сообщение" });
    const second = await request(app).post("/api/conversations").set(CSRF).set("Cookie", buyer.cookie)
      .send({ listingId: listing.id, message: "Второе сообщение" });

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.messages).toHaveLength(2);

    const buyerInbox = await request(app).get("/api/conversations").set("Cookie", buyer.cookie);
    expect(buyerInbox.body).toHaveLength(1);
  });

  it("a buyer cannot start a thread on a draft (unpublished) listing — 404, not exposed", async () => {
    const seller = await registerAndLogin(request, "seller3@zavod.ru", "supplier", "Завод 3");
    const buyer = await registerAndLogin(request, "buyer3@stroydvor.ru", "buyer", "СтройДвор 3");

    const createRes = await request(app).post("/api/listings").set(CSRF).set("Cookie", seller.cookie).send({
      title: "Черновик товара",
      description: "Ещё не опубликован",
      category: "Мебель",
      price: 1000,
    });

    const res = await request(app).post("/api/conversations").set(CSRF).set("Cookie", buyer.cookie)
      .send({ listingId: createRes.body.id, message: "Привет" });
    expect(res.status).toBe(404);
  });

  it("a supplier cannot start a conversation (buyer-only)", async () => {
    const seller = await registerAndLogin(request, "seller4@zavod.ru", "supplier", "Завод 4");
    const otherSupplier = await registerAndLogin(request, "seller5@zavod.ru", "supplier", "Завод 5");
    const listing = await createAndPublishListing(request, seller.cookie);

    const res = await request(app).post("/api/conversations").set(CSRF).set("Cookie", otherSupplier.cookie)
      .send({ listingId: listing.id, message: "Привет" });
    expect(res.status).toBe(403);
  });

  it("a company uninvolved in a conversation gets 404, and the thread never appears in their list (cross-tenant isolation)", async () => {
    const seller = await registerAndLogin(request, "seller6@zavod.ru", "supplier", "Завод 6");
    const buyer = await registerAndLogin(request, "buyer6@stroydvor.ru", "buyer", "СтройДвор 6");
    const outsider = await registerAndLogin(request, "outsider@other.ru", "buyer", "Посторонняя компания");
    const listing = await createAndPublishListing(request, seller.cookie);

    const startRes = await request(app).post("/api/conversations").set(CSRF).set("Cookie", buyer.cookie)
      .send({ listingId: listing.id, message: "Привет" });
    const conversationId = startRes.body.id;

    const outsiderGet = await request(app).get(`/api/conversations/${conversationId}`).set("Cookie", outsider.cookie);
    expect(outsiderGet.status).toBe(404);

    const outsiderReply = await request(app).post(`/api/conversations/${conversationId}/messages`).set(CSRF).set("Cookie", outsider.cookie)
      .send({ message: "Не моё дело" });
    expect(outsiderReply.status).toBe(404);

    const outsiderList = await request(app).get("/api/conversations").set("Cookie", outsider.cookie);
    expect(outsiderList.body).toHaveLength(0);
  });

  it("opening a thread marks the other party's messages read and clears the unread count", async () => {
    const seller = await registerAndLogin(request, "seller7@zavod.ru", "supplier", "Завод 7");
    const buyer = await registerAndLogin(request, "buyer7@stroydvor.ru", "buyer", "СтройДвор 7");
    const listing = await createAndPublishListing(request, seller.cookie);

    const startRes = await request(app).post("/api/conversations").set(CSRF).set("Cookie", buyer.cookie)
      .send({ listingId: listing.id, message: "Привет" });
    const conversationId = startRes.body.id;

    const beforeUnread = await request(app).get("/api/conversations/unread-count").set("Cookie", seller.cookie);
    expect(beforeUnread.body.count).toBe(1);

    await request(app).get(`/api/conversations/${conversationId}`).set("Cookie", seller.cookie);

    const afterUnread = await request(app).get("/api/conversations/unread-count").set("Cookie", seller.cookie);
    expect(afterUnread.body.count).toBe(0);
  });

  it("the seller can reply and the buyer sees the reply in the thread", async () => {
    const seller = await registerAndLogin(request, "seller8@zavod.ru", "supplier", "Завод 8");
    const buyer = await registerAndLogin(request, "buyer8@stroydvor.ru", "buyer", "СтройДвор 8");
    const listing = await createAndPublishListing(request, seller.cookie);

    const startRes = await request(app).post("/api/conversations").set(CSRF).set("Cookie", buyer.cookie)
      .send({ listingId: listing.id, message: "Есть в наличии?" });
    const conversationId = startRes.body.id;

    const replyRes = await request(app).post(`/api/conversations/${conversationId}/messages`).set(CSRF).set("Cookie", seller.cookie)
      .send({ message: "Да, есть." });
    expect(replyRes.status).toBe(201);

    const buyerThread = await request(app).get(`/api/conversations/${conversationId}`).set("Cookie", buyer.cookie);
    expect(buyerThread.body.messages).toHaveLength(2);
    expect(buyerThread.body.messages[1].body).toBe("Да, есть.");
  });

  it("rate-limits per account when a buyer spams messages into a thread — each send would otherwise fire a real SMS/Telegram notification", async () => {
    const seller = await registerAndLogin(request, "seller9@zavod.ru", "supplier", "Завод 9");
    const buyer = await registerAndLogin(request, "buyer9@stroydvor.ru", "buyer", "СтройДвор 9");
    const listing = await createAndPublishListing(request, seller.cookie);

    const startRes = await request(app).post("/api/conversations").set(CSRF).set("Cookie", buyer.cookie)
      .send({ listingId: listing.id, message: "Сообщение 0" });
    const conversationId = startRes.body.id;

    // The route limit is 60/hour. startConversation's own first message goes
    // through the messaging *service* directly, not this route's middleware,
    // so it doesn't count toward this counter — the loop below is what fills it.
    for (let i = 1; i <= 60; i++) {
      const res = await request(app).post(`/api/conversations/${conversationId}/messages`).set(CSRF).set("Cookie", buyer.cookie)
        .send({ message: `Сообщение ${i}` });
      expect(res.status).toBe(201);
    }

    const limited = await request(app).post(`/api/conversations/${conversationId}/messages`).set(CSRF).set("Cookie", buyer.cookie)
      .send({ message: "Один лишний" });
    expect(limited.status).toBe(429);
  });

  it("rate-limits per account when a buyer spams new conversation starts", async () => {
    const seller = await registerAndLogin(request, "seller10@zavod.ru", "supplier", "Завод 10");
    const buyer = await registerAndLogin(request, "buyer10@stroydvor.ru", "buyer", "СтройДвор 10");
    // Created sequentially, not concurrently — concurrent creation under the
    // same default title races on slug assignment, a separate, pre-existing
    // concurrency gap in listings/service.ts that's out of scope here.
    const listings = [];
    for (let i = 0; i < 21; i++) listings.push(await createAndPublishListing(request, seller.cookie));

    for (let i = 0; i < 20; i++) {
      const res = await request(app).post("/api/conversations").set(CSRF).set("Cookie", buyer.cookie)
        .send({ listingId: listings[i].id, message: "Привет" });
      expect(res.status).toBe(201);
    }

    const limited = await request(app).post("/api/conversations").set(CSRF).set("Cookie", buyer.cookie)
      .send({ listingId: listings[20].id, message: "Привет" });
    expect(limited.status).toBe(429);
  });
});
