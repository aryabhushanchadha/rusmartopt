import { prisma } from "../../db/prisma.js";
import { checkAndIncrRateLimit } from "../../middleware/rateLimit.js";
import { timingSafeEqualStr } from "../../utils/tokens.js";
import type { Order } from "@prisma/client";

/**
 * THE security-critical module. Public order tracking was flagged in an
 * earlier review as an IDOR risk: the frontend prototype only checked the
 * phone digits client-side, and order codes were sequential/guessable.
 *
 * Fixes applied here:
 *  - order_code is display-only; the phone check happens server-side only.
 *  - Identical generic response for "no such order" and "wrong phone digits" —
 *    the endpoint never confirms whether a given order_code exists.
 *  - Redis-backed rate limiting, keyed independently by order_code and by IP,
 *    with a lockout window, plus a full audit trail in tracking_lookup_attempts.
 *  - A separate, unthrottled path via the high-entropy public_tracking_token
 *    (used in notification links) — possession of the 128-bit token is itself
 *    sufficient proof, no phone check needed there.
 *  - Only public-safe fields are ever returned: never phone, internal id,
 *    seller/buyer company id, or actor names from the audit log.
 */

const LOCKOUT_ATTEMPTS_PER_CODE = 5;
const LOCKOUT_WINDOW_SECONDS_CODE = 15 * 60;
const LOCKOUT_ATTEMPTS_PER_IP = 20;
const LOCKOUT_WINDOW_SECONDS_IP = 15 * 60;

export class TrackingRateLimited extends Error {}
export class TrackingNotFound extends Error {} // used for both "no such order" and "wrong phone" — caller must not distinguish

function publicView(order: Order) {
  return {
    orderCode: order.orderCode,
    product: order.product,
    buyerCompanyName: order.buyerCompanyName,
    city: order.city,
    stage: order.stage,
    shipStage: order.shipStage,
    dueDate: order.dueDate,
    trackingNumber: order.stage === 7 ? order.trackingNumber : null,
  };
}

export async function lookupByCodeAndPhone(orderCode: string, phoneLast4: string, ip: string) {
  const codeLimit = await checkAndIncrRateLimit(`track:code:${orderCode}`, LOCKOUT_ATTEMPTS_PER_CODE, LOCKOUT_WINDOW_SECONDS_CODE);
  const ipLimit = await checkAndIncrRateLimit(`track:ip:${ip}`, LOCKOUT_ATTEMPTS_PER_IP, LOCKOUT_WINDOW_SECONDS_IP);
  if (!codeLimit.allowed || !ipLimit.allowed) {
    throw new TrackingRateLimited();
  }

  const order = await prisma.order.findUnique({ where: { orderCode } });
  const last4 = order ? order.phone.replace(/\D/g, "").slice(-4) : "";
  const matched = Boolean(order) && timingSafeEqualStr(last4, phoneLast4);

  await prisma.trackingLookupAttempt.create({
    data: { orderCodeAttempted: orderCode, ipAddress: ip, success: matched },
  });

  if (!order || !matched) {
    throw new TrackingNotFound();
  }

  return publicView(order);
}

export async function lookupByToken(token: string) {
  const order = await prisma.order.findUnique({ where: { publicTrackingToken: token } });
  if (!order) throw new TrackingNotFound();
  return publicView(order);
}
