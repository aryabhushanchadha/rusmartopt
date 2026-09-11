import "dotenv/config";
import argon2 from "argon2";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { redis } from "../src/redis/client.js";
import { __setPaymentProviderForTesting } from "../src/modules/billing/service.js";
import type { PaymentProvider, CreatePaymentResult, FetchPaymentResult } from "../src/modules/billing/provider.js";

export const app = buildApp();

/** Wipes all app tables between tests. Requires the docker-compose Postgres to be running. */
export async function resetDb() {
  await prisma.notification.deleteMany();
  await prisma.telegramLink.deleteMany();
  await prisma.orderStageLog.deleteMany();
  await prisma.trackingLookupAttempt.deleteMany();
  await prisma.order.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.paymentWebhookEvent.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
  resetFakePaymentProvider();
}

export async function resetRateLimits() {
  const keys = await redis.keys("ratelimit:*");
  if (keys.length) await redis.del(...keys);
  const trackKeys = await redis.keys("track:*");
  if (trackKeys.length) await redis.del(...trackKeys);
}

/** Extracts the session cookie value from a supertest response's Set-Cookie header. */
export function extractCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
  const match = cookies.find((c) => c.startsWith("rso_session="));
  if (!match) throw new Error("No session cookie in response");
  return match.split(";")[0];
}

export const CSRF = { "X-Requested-With": "rso-frontend" };

export async function registerAndLogin(
  request: typeof import("supertest"),
  email: string,
  companyType: "supplier" | "buyer",
  companyName: string
): Promise<{ cookie: string; userId: string; companyId: string }> {
  const res = await request(app).post("/api/auth/register").set(CSRF).send({
    companyName,
    companyType,
    city: "Москва",
    fullName: "Test User",
    email,
    password: "password123",
  });
  return { cookie: extractCookie(res), userId: res.body.user.id, companyId: res.body.company.id };
}

/** Admin accounts have no self-registration path (registerSchema only allows supplier/buyer) — created directly, matching how scripts/seed.ts does it. */
export async function createAdminAndLogin(
  request: typeof import("supertest"),
  email: string,
  password = "adminpass123"
): Promise<{ cookie: string; userId: string }> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const admin = await prisma.user.create({ data: { email, passwordHash, fullName: "Admin", role: "admin" } });
  const res = await request(app).post("/api/auth/login").set(CSRF).send({ email, password });
  return { cookie: extractCookie(res), userId: admin.id };
}

// ---- fake payment provider for tests: never calls real ЮKassa ----
let fakeCounter = 0;
const fakeStatuses = new Map<string, { status: string; paid: boolean; amountRub: number; paymentMethodId?: string }>();
// Real ЮKassa deduplicates concurrent/retried requests carrying the same
// Idempotence-Key, returning the SAME payment object instead of creating a
// second one — this map replicates that so tests can actually exercise the
// double-charge-prevention logic in service.ts/renewalService.ts, not just
// assume it works.
const idempotenceKeyToPaymentId = new Map<string, string>();
const TRUSTED_TEST_IP = "203.0.113.10"; // arbitrary TEST-NET-3 address, not a real YooKassa range

export const fakePaymentProvider: PaymentProvider = {
  async createPayment(input): Promise<CreatePaymentResult> {
    const existingId = idempotenceKeyToPaymentId.get(input.idempotenceKey);
    if (existingId) {
      const state = fakeStatuses.get(existingId)!;
      return { providerPaymentId: existingId, confirmationUrl: `https://fake-yookassa.test/pay/${existingId}`, status: state.status };
    }
    const providerPaymentId = `fake_payment_${++fakeCounter}`;
    idempotenceKeyToPaymentId.set(input.idempotenceKey, providerPaymentId);
    fakeStatuses.set(providerPaymentId, { status: "pending", paid: false, amountRub: input.amountRub });
    return { providerPaymentId, confirmationUrl: `https://fake-yookassa.test/pay/${providerPaymentId}`, status: "pending" };
  },
  async fetchPayment(providerPaymentId): Promise<FetchPaymentResult> {
    const state = fakeStatuses.get(providerPaymentId);
    if (!state) throw new Error(`fakePaymentProvider: unknown providerPaymentId ${providerPaymentId}`);
    return { status: state.status, paid: state.paid, amountRub: state.amountRub, paymentMethodId: state.paymentMethodId, metadata: {} };
  },
  isWebhookSourceTrusted(ip): boolean {
    return ip === TRUSTED_TEST_IP;
  },
};

/** Test-only: flips a fake payment to a given provider-reported status, as if the real ЮKassa side changed it. */
export function fakeSetPaymentStatus(providerPaymentId: string, status: string, paid: boolean, paymentMethodId?: string) {
  const existing = fakeStatuses.get(providerPaymentId);
  fakeStatuses.set(providerPaymentId, { status, paid, amountRub: existing?.amountRub ?? 0, paymentMethodId });
}

export function resetFakePaymentProvider() {
  fakeStatuses.clear();
  idempotenceKeyToPaymentId.clear();
  __setPaymentProviderForTesting(fakePaymentProvider);
}

export { TRUSTED_TEST_IP };

export async function createAndPublishListing(
  request: typeof import("supertest"),
  cookie: string,
  overrides: Partial<{ title: string; description: string; price: number }> = {}
): Promise<{ id: string; slug: string; companySlug: string }> {
  const createRes = await request(app).post("/api/listings").set(CSRF).set("Cookie", cookie).send({
    title: "Стеллаж торговый МГ-200",
    description: "Прочный складской стеллаж",
    category: "Мебель",
    price: 7200,
    ...overrides,
  });
  const id = createRes.body.id;
  const slug = createRes.body.slug;
  await request(app).post(`/api/listings/${id}/publish`).set(CSRF).set("Cookie", cookie).send({});
  const meRes = await request(app).get("/api/companies/me").set("Cookie", cookie);
  return { id, slug, companySlug: meRes.body.slug };
}

/** Test-only: seeds an already-active marketplace_full subscription directly, bypassing checkout/webhook. */
export async function createActiveSubscription(companyId: string) {
  return prisma.subscription.create({
    data: {
      companyId,
      plan: "marketplace_full",
      status: "active",
      priceRub: 24999,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    },
  });
}
