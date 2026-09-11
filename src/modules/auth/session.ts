import { redis } from "../../redis/client.js";
import { randomToken, sha256Hex } from "../../utils/tokens.js";
import { env } from "../../config/env.js";

export interface SessionData {
  userId: string;
  role: "supplier" | "buyer" | "admin";
  companyId: string | null;
}

const keyFor = (tokenHash: string) => `session:${tokenHash}`;

export async function createSession(data: SessionData): Promise<string> {
  const token = randomToken(32);
  const hash = sha256Hex(token);
  await redis.set(keyFor(hash), JSON.stringify(data), "EX", env.SESSION_TTL_SECONDS);
  return token;
}

export async function getSession(token: string): Promise<SessionData | null> {
  const hash = sha256Hex(token);
  const raw = await redis.get(keyFor(hash));
  if (!raw) return null;
  // sliding refresh: extend TTL on each successful lookup
  await redis.expire(keyFor(hash), env.SESSION_TTL_SECONDS);
  return JSON.parse(raw) as SessionData;
}

export async function destroySession(token: string): Promise<void> {
  const hash = sha256Hex(token);
  await redis.del(keyFor(hash));
}
