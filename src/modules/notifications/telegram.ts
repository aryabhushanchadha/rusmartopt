import { Telegraf } from "telegraf";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { prisma } from "../../db/prisma.js";

let bot: Telegraf | null = null;

export function getBot(): Telegraf | null {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  if (!bot) {
    bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
    // Deep-link flow: a customer opens t.me/<bot>?start=<public_tracking_token>
    // from a notification link. We resolve the token to an order and remember
    // this chat_id so future stage-change notifications can be pushed to them
    // directly, without needing a phone number on file for Telegram delivery.
    bot.start(async (ctx) => {
      const token = ctx.startPayload;
      if (!token) {
        await ctx.reply("Добро пожаловать в RuSmartOpt. Откройте ссылку из уведомления о заказе, чтобы подключить отслеживание.");
        return;
      }
      const order = await prisma.order.findUnique({ where: { publicTrackingToken: token } });
      if (!order) {
        await ctx.reply("Заказ по этой ссылке не найден.");
        return;
      }
      await prisma.telegramLink.create({
        data: { orderId: order.id, chatId: String(ctx.chat.id) },
      });
      await ctx.reply(`Готово! Вы будете получать уведомления по заказу ${order.orderCode}.`);
    });
  }
  return bot;
}

export async function sendTelegramForOrder(orderId: string, message: string): Promise<{ ok: boolean; response: unknown }> {
  const b = getBot();
  if (!b) {
    logger.warn("Telegram bot token not configured; skipping real Telegram send", { orderId });
    return { ok: false, response: { error: "not_configured" } };
  }
  const link = await prisma.telegramLink.findFirst({ where: { orderId }, orderBy: { linkedAt: "desc" } });
  if (!link) {
    // Not yet linked (customer hasn't opened the deep link) — not an error, just nothing to send to yet.
    return { ok: false, response: { error: "no_linked_chat" } };
  }
  try {
    await b.telegram.sendMessage(link.chatId, message);
    return { ok: true, response: { chatId: link.chatId } };
  } catch (err) {
    logger.error("Telegram send failed", { err: err instanceof Error ? err.message : String(err) });
    return { ok: false, response: { error: "send_failed" } };
  }
}

/**
 * Company-level equivalent of sendTelegramForOrder, for billing/messaging
 * notifications that aren't tied to one order. TelegramLink.companyId exists
 * in the schema for this, but no deep-link UI populates it yet (only the
 * order-tracking flow does) — so this will realistically no-op with
 * "no_linked_chat" until that's built, same honest pattern as above, not a
 * silent failure. SMS (Company.notifyPhone) is the functional fallback today.
 */
export async function sendTelegramForCompany(companyId: string, message: string): Promise<{ ok: boolean; response: unknown }> {
  const b = getBot();
  if (!b) {
    logger.warn("Telegram bot token not configured; skipping real Telegram send", { companyId });
    return { ok: false, response: { error: "not_configured" } };
  }
  const link = await prisma.telegramLink.findFirst({ where: { companyId }, orderBy: { linkedAt: "desc" } });
  if (!link) {
    return { ok: false, response: { error: "no_linked_chat" } };
  }
  try {
    await b.telegram.sendMessage(link.chatId, message);
    return { ok: true, response: { chatId: link.chatId } };
  } catch (err) {
    logger.error("Telegram send failed", { err: err instanceof Error ? err.message : String(err) });
    return { ok: false, response: { error: "send_failed" } };
  }
}
