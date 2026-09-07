import "dotenv/config";

interface Env {
  BOT_TOKEN: string;
  DATABASE_URL: string;
  WEBHOOK_SECRET: string;
  PORT: number;
  RENDER_EXTERNAL_URL: string | undefined;
  NODE_ENV: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable "${name}". Copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

function loadEnv(): Env {
  return {
    BOT_TOKEN: required("BOT_TOKEN"),
    DATABASE_URL: required("DATABASE_URL"),
    WEBHOOK_SECRET: required("WEBHOOK_SECRET"),
    PORT: Number(process.env.PORT ?? 3000),
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL?.replace(/\/+$/, ""),
    NODE_ENV: process.env.NODE_ENV ?? "development",
  };
}

let cached: Env | undefined;

/** Lazily loads and validates process.env. Throws with a clear message if something required is missing. */
export function getEnv(): Env {
  if (!cached) {
    cached = loadEnv();
  }
  return cached;
}
