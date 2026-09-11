import { prisma } from "../../db/prisma.js";
import { smscProvider } from "./sms.js";
import { sendTelegramForOrder, sendTelegramForCompany } from "./telegram.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { STAGE_LABELS, tn, type Lang } from "../../i18n/notifications.js";
import type { Order, Company, Conversation } from "@prisma/client";

type NotifyEvent = "stage_advanced" | "shipped" | "ship_stage_advanced" | "manual";

/**
 * An Order isn't itself tied to a language — its phone/channel are just
 * contact fields the supplier typed in. If the order links to a registered
 * buyer company (buyerCompanyId), that company's own notifyLanguage is the
 * best signal of what language the actual recipient reads; otherwise ru,
 * matching this app's original (pre-i18n) behavior exactly.
 */
async function orderLanguage(order: Order): Promise<Lang> {
  if (!order.buyerCompanyId) return "ru";
  const buyer = await prisma.company.findUnique({ where: { id: order.buyerCompanyId }, select: { notifyLanguage: true } });
  return buyer?.notifyLanguage ?? "ru";
}

async function messageFor(order: Order, event: NotifyEvent): Promise<string> {
  const lang = await orderLanguage(order);
  const stageLabel = STAGE_LABELS[lang][order.stage];
  // Was hardcoded to "https://rusmartopt.ru/track?t=..." — wrong on two
  // counts: the domain ignored env.PUBLIC_BASE_URL entirely (so it was
  // silently wrong in every non-production environment), and "/track" was
  // never a real route on either the API or the SPA — the actual public
  // lookup lives at the landing page's #ptrack section, and nothing read a
  // "?t=" param to auto-run the token-based lookup before now (see the
  // captureTrackToken() handling added to frontend/index.html alongside
  // this fix). Every order notification sent before this fix contained a
  // dead link.
  const trackUrl = `${env.PUBLIC_BASE_URL}/?t=${order.publicTrackingToken}#ptrack`;
  const t = tn(lang);
  switch (event) {
    case "shipped":
      return t.orderShipped(order.orderCode, order.trackingNumber, trackUrl);
    case "ship_stage_advanced":
      return t.orderShipStageAdvanced(order.orderCode, trackUrl);
    case "manual":
      return t.orderManualStatus(order.orderCode, stageLabel, trackUrl);
    case "stage_advanced":
    default:
      return t.orderStageAdvanced(order.orderCode, stageLabel, trackUrl);
  }
}

export async function sendOrderNotification(order: Order, event: NotifyEvent) {
  const message = await messageFor(order, event);
  const notification = await prisma.notification.create({
    data: {
      orderId: order.id,
      channel: order.notifyChannel,
      recipient: order.notifyChannel === "sms" ? order.phone : "(telegram)",
      message,
      status: "pending",
    },
  });

  const result =
    order.notifyChannel === "sms"
      ? await smscProvider.send(order.phone, message)
      : await sendTelegramForOrder(order.id, message);

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: result.ok ? "sent" : "failed",
      providerResponse: result.response as never,
      sentAt: result.ok ? new Date() : null,
    },
  });

  if (!result.ok) {
    logger.warn("Notification send failed", { orderId: order.id, channel: order.notifyChannel, response: result.response });
  }

  return updated;
}

export function isNotificationsConfigured() {
  return Boolean(env.TELEGRAM_BOT_TOKEN || (env.SMSC_LOGIN && env.SMSC_PASSWORD));
}

/**
 * Company-level notification (billing, messaging) — the poly counterpart of
 * sendOrderNotification. Prefers Telegram, falls back to SMS via
 * Company.notifyPhone, and — matching sendTelegramForOrder's existing
 * semantics — never throws and never blocks the calling action (a stage
 * change, a sent message) if the recipient has no channel configured. Exactly
 * one of orderId/conversationId should be set on the resulting Notification
 * row; this function itself only ever sets one or the other, never both.
 */
async function sendCompanyNotification(
  company: Company,
  message: string,
  link: { orderId?: string; conversationId?: string }
) {
  if (!company.notifyChannel) {
    logger.warn("Company has no notify channel configured; skipping", { companyId: company.id });
    return null;
  }
  const notification = await prisma.notification.create({
    data: {
      orderId: link.orderId,
      conversationId: link.conversationId,
      channel: company.notifyChannel,
      recipient: company.notifyChannel === "sms" ? company.notifyPhone ?? "" : "(telegram)",
      message,
      status: "pending",
    },
  });

  const result =
    company.notifyChannel === "sms" && company.notifyPhone
      ? await smscProvider.send(company.notifyPhone, message)
      : await sendTelegramForCompany(company.id, message);

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: result.ok ? "sent" : "failed",
      providerResponse: result.response as never,
      sentAt: result.ok ? new Date() : null,
    },
  });

  if (!result.ok) {
    logger.warn("Company notification send failed", { companyId: company.id, response: result.response });
  }
  return updated;
}

/** `build` receives the company's own notifyLanguage — callers compose the actual text via i18n/notifications.ts's `tn(lang)` templates rather than passing pre-built Russian text. */
export async function sendBillingNotification(company: Company, build: (lang: Lang) => string) {
  return sendCompanyNotification(company, build(company.notifyLanguage), {});
}

export async function sendMessageNotification(company: Company, conversation: Conversation, senderName: string) {
  const text = tn(company.notifyLanguage).newMessage(senderName);
  return sendCompanyNotification(company, text, { conversationId: conversation.id });
}
