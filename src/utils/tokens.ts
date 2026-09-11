import crypto from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** High-entropy (128-bit) base62 token — used for public_tracking_token and session tokens. */
export function randomToken(bytes = 16): string {
  const buf = crypto.randomBytes(bytes);
  let num = BigInt("0x" + buf.toString("hex"));
  if (num === 0n) return "0";
  let out = "";
  const base = BigInt(62);
  while (num > 0n) {
    out = BASE62[Number(num % base)] + out;
    num /= base;
  }
  return out;
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // still run a comparison of equal length to avoid a trivial length-based timing signal
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates a human-readable order code, e.g. "ЗК-482017". It IS used as the
 * lookup key for POST /api/track/lookup (paired with a phone check and rate
 * limiting there — see modules/tracking), so it needs real entropy, not just
 * enough to look plausible: crypto.randomInt over a 900,000-value range,
 * rather than Math.random() over 9,000, which two independent reviews flagged
 * as both a predictability concern and — since createOrder retries a fixed
 * number of times on collision — an availability problem as order volume grows.
 */
export function generateOrderCode(): string {
  const n = crypto.randomInt(100000, 1000000);
  return `ЗК-${n}`;
}
