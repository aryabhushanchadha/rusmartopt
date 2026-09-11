/**
 * Payment provider seam — mirrors modules/notifications/sms.ts's SmsProvider
 * pattern exactly. yookassa.ts is the only file that changes if the provider
 * is ever swapped; nothing outside this module should import ЮKassa specifics.
 */
export interface CreatePaymentInput {
  amountRub: number;
  description: string;
  returnUrl: string;
  idempotenceKey: string;
  metadata: Record<string, string>;
  /** Save the payment method for future off-session renewal charges. */
  savePaymentMethod?: boolean;
  /** Charge a previously-saved method directly (renewals) instead of opening a new checkout. */
  paymentMethodId?: string;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  /** Present for a new checkout; absent when charging a saved method directly. */
  confirmationUrl?: string;
  status: string;
}

export interface FetchPaymentResult {
  status: string;
  paid: boolean;
  amountRub: number;
  paymentMethodId?: string;
  metadata: Record<string, string>;
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /**
   * Re-fetches a payment's status directly from the provider using our own
   * authenticated credentials. This — never the webhook body — is the only
   * thing allowed to drive a Subscription/Payment state change.
   */
  fetchPayment(providerPaymentId: string): Promise<FetchPaymentResult>;
  isWebhookSourceTrusted(ip: string): boolean;
}
