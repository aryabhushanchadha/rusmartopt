import type { Request, Response, NextFunction } from "express";
import { redis } from "../redis/client.js";

/**
 * Sliding-window-ish fixed-window rate limiter backed by Redis INCR + TTL.
 * Used specifically to protect the public order-tracking lookup endpoint,
 * which is the one confirmed real-world exposure in this system (see
 * modules/tracking). Two independent limits are applied by the caller:
 * one keyed by order_code, one keyed by IP.
 */
export async function checkAndIncrRateLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const redisKey = `ratelimit:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, windowSeconds);
  }
  return { allowed: count <= maxAttempts, remaining: Math.max(0, maxAttempts - count) };
}

export function clientIp(req: Request): string {
  const fwd = req.get("X-Forwarded-For");
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

/** Generic express middleware for simple per-IP limiting on any route. */
export function ipRateLimit(maxAttempts: number, windowSeconds: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = clientIp(req);
    const { allowed } = await checkAndIncrRateLimit(`ip:${req.path}:${ip}`, maxAttempts, windowSeconds);
    if (!allowed) {
      res.status(429).json({ error: "Слишком много запросов, попробуйте позже" });
      return;
    }
    next();
  };
}

/**
 * Per-authenticated-account limiting — for routes already behind requireAuth,
 * where scoping by account is more precise than by IP (shared office
 * NAT/VPN egress would otherwise rate-limit unrelated accounts together).
 * `keyName` is an explicit logical route name rather than req.path, since
 * routes like POST /:id/messages have a param in the path that would
 * otherwise fragment the limit across every conversation id.
 */
export function userRateLimit(keyName: string, maxAttempts: number, windowSeconds: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.userId;
    if (!userId) { next(); return; } // requireAuth should already have rejected this — nothing to key on
    const { allowed } = await checkAndIncrRateLimit(`user:${keyName}:${userId}`, maxAttempts, windowSeconds);
    if (!allowed) {
      res.status(429).json({ error: "Слишком много запросов, попробуйте позже" });
      return;
    }
    next();
  };
}
