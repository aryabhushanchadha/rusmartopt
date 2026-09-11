import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

export interface SmsProvider {
  send(to: string, message: string): Promise<{ ok: boolean; response: unknown }>;
}

/**
 * SMSC.ru HTTP API client. Swappable via the SmsProvider interface — if this
 * gateway ever needs to change (e.g. to SMS.ru), only this file changes.
 * https://smsc.ru/api/http/
 */
export const smscProvider: SmsProvider = {
  async send(to: string, message: string) {
    if (!env.SMSC_LOGIN || !env.SMSC_PASSWORD) {
      logger.warn("SMSC credentials not configured; skipping real SMS send", { to });
      return { ok: false, response: { error: "not_configured" } };
    }
    const params = new URLSearchParams({
      login: env.SMSC_LOGIN,
      psw: env.SMSC_PASSWORD,
      phones: to,
      mes: message,
      sender: env.SMSC_SENDER_NAME,
      fmt: "3", // JSON response
      charset: "utf-8",
    });
    try {
      const res = await fetch(`https://smsc.ru/sys/send.php?${params.toString()}`);
      const json = await res.json();
      const ok = !("error" in (json as Record<string, unknown>));
      return { ok, response: json };
    } catch (err) {
      logger.error("SMSC send failed", { err: err instanceof Error ? err.message : String(err) });
      return { ok: false, response: { error: "network_error" } };
    }
  },
};
