import "dotenv/config";
import { z } from "zod";

/**
 * Centralised, validated environment configuration.
 * The app refuses to boot with an invalid env so misconfiguration fails fast.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().min(1).default("./data/paperqueue.db"),

  /** Publicly reachable base URL of THIS server (used to build OAuth callback). */
  SERVER_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  /** Deep link the server redirects to after OAuth, caught by the app. */
  APP_CALLBACK_URL: z.string().default("paperqueue://auth/done"),

  // Zotero OAuth credentials — optional until the user registers an app.
  ZOTERO_CLIENT_KEY: z.string().optional(),
  ZOTERO_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "Invalid environment variables:",
      JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";

/** True when Zotero OAuth credentials are configured. */
export const hasZoteroCredentials = Boolean(
  env.ZOTERO_CLIENT_KEY && env.ZOTERO_CLIENT_SECRET,
);
