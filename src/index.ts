import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { getBot } from "./modules/notifications/telegram.js";

const app = buildApp();

app.listen(env.PORT, () => {
  logger.info(`RuSmartOpt API listening on :${env.PORT}`, { env: env.NODE_ENV });
});

// Long-polling in dev/early production; switch to bot.launch({webhook: ...})
// once deployed behind a stable public HTTPS URL (Yandex Cloud phase).
const bot = getBot();
if (bot) {
  bot.launch();
  logger.info("Telegram bot started (long polling)");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
} else {
  logger.warn("TELEGRAM_BOT_TOKEN not set — Telegram notifications disabled");
}
