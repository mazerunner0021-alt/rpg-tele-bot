type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel: Level = (process.env.LOG_LEVEL as Level) ?? "info";

function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  const payload = meta ? ` ${safeStringify(meta)}` : "";
  const out = `${line}${payload}`;
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

function safeStringify(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  } catch {
    return "[unserializable meta]";
  }
}

/** Minimal leveled logger. No external dependency — this is a hobby-scale bot, not a service with an observability budget. */
export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};
