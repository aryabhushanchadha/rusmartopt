import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGINS: z.string().default(""),
  SESSION_COOKIE_NAME: z.string().default("rso_session"),
  SESSION_TTL_SECONDS: z.coerce.number().default(604800),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_BOT_USERNAME: z.string().optional().default(""),
  SMSC_LOGIN: z.string().optional().default(""),
  SMSC_PASSWORD: z.string().optional().default(""),
  SMSC_SENDER_NAME: z.string().optional().default("RuSmartOpt"),
  // Absolute origin used for canonical URLs, Open Graph tags, and the
  // sitemap — must be set to the real public domain in production.
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  // Where the authenticated SPA is served from — used to build ЮKassa's
  // return_url and the message-compose intent handoff link.
  FRONTEND_BASE_URL: z.string().url().default("http://localhost:5173"),

  // ЮKassa (YooKassa) — real RU payment gateway. Empty in dev/test; billing
  // checkout will fail loudly (not silently) until these are set.
  YOOKASSA_SHOP_ID: z.string().optional().default(""),
  YOOKASSA_SECRET_KEY: z.string().optional().default(""),
  // Comma-separated CIDR ranges. ЮKassa publishes these; kept configurable
  // since they can change — see https://yookassa.ru/developers/using-api/webhooks
  YOOKASSA_WEBHOOK_IP_ALLOWLIST: z.string().default(
    "185.71.76.0/27,185.71.77.0/27,77.75.153.0/25,77.75.156.11/32,77.75.156.35/32,77.75.154.128/25,2a02:5180::/32"
  ),

  // Master switch: when false (default), listing publish is never blocked by
  // subscription status — see modules/listings/service.ts setPublished().
  PAYWALL_ENFORCEMENT_ENABLED: z.coerce.boolean().default(false),
  // How many "first N" marketplace subscribers get the promo price — matches
  // the landing page's "первые 100" copy; overridable for tests.
  PROMO_SLOTS: z.coerce.number().default(100),
  PROMO_PRICE_RUB: z.coerce.number().default(15000),
  SOFTWARE_PRICE_RUB: z.coerce.number().default(10000),
  MARKETPLACE_PRICE_RUB: z.coerce.number().default(24999),
  // Grace window after a failed renewal before a subscription is marked expired.
  PAST_DUE_GRACE_DAYS: z.coerce.number().default(7),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
};
