import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { ipInAllowlist } from "../../utils/cidr.js";
import type { PaymentProvider, CreatePaymentInput, CreatePaymentResult, FetchPaymentResult } from "./provider.js";

const API_BASE = "https://api.yookassa.ru/v3";

function authHeader(): string {
  const token = Buffer.from(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`).toString("base64");
  return `Basic ${token}`;
}

function toRubles(amountRub: number): { value: string; currency: "RUB" } {
  return { value: amountRub.toFixed(2), currency: "RUB" };
}

export const yookassaProvider: PaymentProvider = {
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!env.YOOKASSA_SHOP_ID || !env.YOOKASSA_SECRET_KEY) {
      throw new Error("ЮKassa не настроена (YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY отсутствуют)");
    }
    const body: Record<string, unknown> = {
      amount: toRubles(input.amountRub),
      description: input.description,
      capture: true,
      metadata: input.metadata,
    };
    if (input.paymentMethodId) {
      // Off-session renewal charge against a previously saved method — no
      // confirmation/redirect involved, ЮKassa charges directly.
      body.payment_method_id = input.paymentMethodId;
    } else {
      body.confirmation = { type: "redirect", return_url: input.returnUrl };
      if (input.savePaymentMethod) body.save_payment_method = true;
    }

    const res = await fetch(`${API_BASE}/payments`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        "Idempotence-Key": input.idempotenceKey,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { id: string; status: string; confirmation?: { confirmation_url?: string } };
    if (!res.ok) {
      logger.error("YooKassa createPayment failed", { status: res.status, json });
      throw new Error("Не удалось создать платёж в ЮKassa");
    }
    return {
      providerPaymentId: json.id,
      confirmationUrl: json.confirmation?.confirmation_url,
      status: json.status,
    };
  },

  /**
   * The security-critical call: re-fetches a payment's status directly from
   * ЮKassa using our own credentials. A forged webhook POST cannot forge
   * what this returns, since it never has our secret key — see
   * modules/billing/webhookService.ts, which never trusts the webhook body.
   */
  async fetchPayment(providerPaymentId: string): Promise<FetchPaymentResult> {
    const res = await fetch(`${API_BASE}/payments/${providerPaymentId}`, {
      headers: { Authorization: authHeader() },
    });
    const json = (await res.json()) as {
      status: string;
      paid: boolean;
      amount: { value: string; currency: string };
      payment_method?: { id: string; saved?: boolean };
      metadata?: Record<string, string>;
    };
    if (!res.ok) {
      logger.error("YooKassa fetchPayment failed", { status: res.status, providerPaymentId, json });
      throw new Error("Не удалось проверить статус платежа в ЮKassa");
    }
    return {
      status: json.status,
      paid: json.paid === true,
      amountRub: Math.round(Number(json.amount.value)),
      paymentMethodId: json.payment_method?.saved ? json.payment_method.id : undefined,
      metadata: json.metadata ?? {},
    };
  },

  isWebhookSourceTrusted(ip: string): boolean {
    return ipInAllowlist(ip, env.YOOKASSA_WEBHOOK_IP_ALLOWLIST);
  },
};
