/**
 * Server-generated SMS/Telegram notification text, in every language the
 * platform supports. This is deliberately separate from the frontend SPA's
 * own I18N dictionary (frontend/index.html) — different runtime, and this
 * one only needs the handful of message shapes the backend actually sends,
 * not the whole UI's vocabulary.
 */
export type Lang = "ru" | "en" | "zh" | "vi";
export const LANGUAGES: Lang[] = ["ru", "en", "zh", "vi"];

export const STAGE_LABELS: Record<Lang, string[]> = {
  ru: ["Новый", "Раскрой", "Сборка", "Покраска", "ОТК", "Упаковка", "Готов к отгрузке", "Отгружен"],
  en: ["New", "Cutting", "Assembly", "Painting", "QC", "Packing", "Ready to ship", "Shipped"],
  zh: ["新建", "下料", "组装", "喷漆", "质检", "包装", "待发货", "已发货"],
  vi: ["Mới", "Cắt", "Lắp ráp", "Sơn", "Kiểm tra chất lượng", "Đóng gói", "Sẵn sàng giao", "Đã giao"],
};

export const PLAN_LABELS: Record<Lang, { software: string; marketplace_full: string }> = {
  ru: { software: "ПО для производства", marketplace_full: "Маркетплейс + ПО" },
  en: { software: "Production software", marketplace_full: "Marketplace + software" },
  zh: { software: "生产管理软件", marketplace_full: "市场 + 软件" },
  vi: { software: "Phần mềm sản xuất", marketplace_full: "Sàn giao dịch + phần mềm" },
};

/** Fixed set of reasons a renewal charge didn't go through — a closed key, not free text, so it translates cleanly instead of being baked into Russian at the call site. */
export type PastDueReason = "no_saved_method" | "charge_request_failed" | "payment_declined" | "awaiting_confirmation";

const PAST_DUE_REASONS: Record<Lang, Record<PastDueReason, string>> = {
  ru: {
    no_saved_method: "нет сохранённого способа оплаты",
    charge_request_failed: "не удалось выполнить платёж",
    payment_declined: "платёж отклонён",
    awaiting_confirmation: "платёж ожидает подтверждения",
  },
  en: {
    no_saved_method: "no saved payment method",
    charge_request_failed: "the charge could not be processed",
    payment_declined: "payment declined",
    awaiting_confirmation: "payment awaiting confirmation",
  },
  zh: {
    no_saved_method: "没有已保存的支付方式",
    charge_request_failed: "扣款失败",
    payment_declined: "支付被拒绝",
    awaiting_confirmation: "支付待确认",
  },
  vi: {
    no_saved_method: "chưa lưu phương thức thanh toán",
    charge_request_failed: "không thể thực hiện thanh toán",
    payment_declined: "thanh toán bị từ chối",
    awaiting_confirmation: "thanh toán đang chờ xác nhận",
  },
};

interface NotificationTemplates {
  orderStageAdvanced(orderCode: string, stageLabel: string, trackUrl: string): string;
  orderShipped(orderCode: string, trackingNumber: string | null, trackUrl: string): string;
  orderShipStageAdvanced(orderCode: string, trackUrl: string): string;
  orderManualStatus(orderCode: string, stageLabel: string, trackUrl: string): string;
  subscriptionActivated(planLabel: string): string;
  subscriptionCanceled(planLabel: string): string;
  subscriptionPastDue(planLabel: string, reason: PastDueReason, graceDays: number): string;
  subscriptionExpired(planLabel: string, graceDays: number): string;
  newMessage(senderName: string): string;
}

const templates: Record<Lang, NotificationTemplates> = {
  ru: {
    orderStageAdvanced: (c, s, u) => `RuSmartOpt · Заказ ${c}: этап изменён на «${s}». Отследить: ${u}`,
    orderShipped: (c, t, u) => `RuSmartOpt · Заказ ${c}: отгружен${t ? `, трек-номер ${t}` : ""}. Отследить: ${u}`,
    orderShipStageAdvanced: (c, u) => `RuSmartOpt · Заказ ${c}: обновление по доставке. Отследить: ${u}`,
    orderManualStatus: (c, s, u) => `RuSmartOpt · Заказ ${c}: текущий статус — «${s}». Отследить: ${u}`,
    subscriptionActivated: (p) => `RuSmartOpt · подписка «${p}» активирована.`,
    subscriptionCanceled: (p) => `RuSmartOpt · подписка «${p}» отменена по вашему запросу.`,
    subscriptionPastDue: (p, r, g) => `RuSmartOpt · не удалось продлить подписку «${p}» (${PAST_DUE_REASONS.ru[r]}). У вас есть ${g} дн. на обновление способа оплаты.`,
    subscriptionExpired: (p, g) => `RuSmartOpt · подписка «${p}» истекла — оплата не поступила в течение ${g} дн.`,
    newMessage: (n) => `RuSmartOpt · Новое сообщение от ${n}. Откройте раздел «Сообщения», чтобы ответить.`,
  },
  en: {
    orderStageAdvanced: (c, s, u) => `RuSmartOpt · Order ${c}: stage changed to "${s}". Track: ${u}`,
    orderShipped: (c, t, u) => `RuSmartOpt · Order ${c}: shipped${t ? `, tracking number ${t}` : ""}. Track: ${u}`,
    orderShipStageAdvanced: (c, u) => `RuSmartOpt · Order ${c}: shipping update. Track: ${u}`,
    orderManualStatus: (c, s, u) => `RuSmartOpt · Order ${c}: current status — "${s}". Track: ${u}`,
    subscriptionActivated: (p) => `RuSmartOpt · subscription "${p}" activated.`,
    subscriptionCanceled: (p) => `RuSmartOpt · subscription "${p}" canceled at your request.`,
    subscriptionPastDue: (p, r, g) => `RuSmartOpt · could not renew subscription "${p}" (${PAST_DUE_REASONS.en[r]}). You have ${g} days to update your payment method.`,
    subscriptionExpired: (p, g) => `RuSmartOpt · subscription "${p}" expired — no payment received within ${g} days.`,
    newMessage: (n) => `RuSmartOpt · New message from ${n}. Open "Messages" to reply.`,
  },
  zh: {
    orderStageAdvanced: (c, s, u) => `RuSmartOpt · 订单 ${c}：阶段已更新为「${s}」。查询物流：${u}`,
    orderShipped: (c, t, u) => `RuSmartOpt · 订单 ${c}：已发货${t ? `，运单号 ${t}` : ""}。查询物流：${u}`,
    orderShipStageAdvanced: (c, u) => `RuSmartOpt · 订单 ${c}：物流状态已更新。查询物流：${u}`,
    orderManualStatus: (c, s, u) => `RuSmartOpt · 订单 ${c}：当前状态 — 「${s}」。查询物流：${u}`,
    subscriptionActivated: (p) => `RuSmartOpt · 订阅「${p}」已激活。`,
    subscriptionCanceled: (p) => `RuSmartOpt · 订阅「${p}」已按您的请求取消。`,
    subscriptionPastDue: (p, r, g) => `RuSmartOpt · 订阅「${p}」续费失败（${PAST_DUE_REASONS.zh[r]}）。您有 ${g} 天时间更新支付方式。`,
    subscriptionExpired: (p, g) => `RuSmartOpt · 订阅「${p}」已过期 — ${g} 天内未收到付款。`,
    newMessage: (n) => `RuSmartOpt · 收到来自 ${n} 的新消息。请打开「消息」查看并回复。`,
  },
  vi: {
    orderStageAdvanced: (c, s, u) => `RuSmartOpt · Đơn hàng ${c}: giai đoạn đã chuyển sang "${s}". Theo dõi: ${u}`,
    orderShipped: (c, t, u) => `RuSmartOpt · Đơn hàng ${c}: đã giao vận${t ? `, mã vận đơn ${t}` : ""}. Theo dõi: ${u}`,
    orderShipStageAdvanced: (c, u) => `RuSmartOpt · Đơn hàng ${c}: cập nhật vận chuyển. Theo dõi: ${u}`,
    orderManualStatus: (c, s, u) => `RuSmartOpt · Đơn hàng ${c}: trạng thái hiện tại — "${s}". Theo dõi: ${u}`,
    subscriptionActivated: (p) => `RuSmartOpt · Gói "${p}" đã được kích hoạt.`,
    subscriptionCanceled: (p) => `RuSmartOpt · Gói "${p}" đã được hủy theo yêu cầu của bạn.`,
    subscriptionPastDue: (p, r, g) => `RuSmartOpt · Không thể gia hạn gói "${p}" (${PAST_DUE_REASONS.vi[r]}). Bạn có ${g} ngày để cập nhật phương thức thanh toán.`,
    subscriptionExpired: (p, g) => `RuSmartOpt · Gói "${p}" đã hết hạn — chưa nhận được thanh toán trong ${g} ngày.`,
    newMessage: (n) => `RuSmartOpt · Tin nhắn mới từ ${n}. Mở "Tin nhắn" để trả lời.`,
  },
};

/** Falls back to Russian for a language that somehow isn't in the table (should never happen — Language is a closed Prisma enum). */
export function tn(lang: Lang): NotificationTemplates {
  return templates[lang] ?? templates.ru;
}
