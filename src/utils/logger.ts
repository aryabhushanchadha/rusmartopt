/** Minimal structured logger. Swap for pino/winston later if needed — kept boring on purpose. */
function log(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  const entry = { level, msg, ...meta, time: new Date().toISOString() };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
};
