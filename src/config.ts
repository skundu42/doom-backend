import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8787),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_STREAM_API_TOKEN: z.string().min(1),
  CLOUDFLARE_STREAM_DELIVERY_BASE_URL: z.string().url().default("https://videodelivery.net"),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: z.string().optional(),
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: z.string().optional(),
  CLOUDFLARE_STREAM_SIGNING_KEY_SECRET: z.string().optional(),
  CORS_ORIGINS: z.string().optional()
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  isProd: env.NODE_ENV === "production",
  host: env.HOST,
  port: env.PORT,
  supabaseUrl: env.SUPABASE_URL,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID,
  cloudflareStreamApiToken: env.CLOUDFLARE_STREAM_API_TOKEN,
  cloudflareDeliveryBaseUrl: env.CLOUDFLARE_STREAM_DELIVERY_BASE_URL.replace(/\/+$/, ""),
  cloudflareWebhookSecret: env.CLOUDFLARE_STREAM_WEBHOOK_SECRET,
  cloudflareSigningKeyId: env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
  cloudflareSigningKeySecret: env.CLOUDFLARE_STREAM_SIGNING_KEY_SECRET,
  corsOrigins: env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(",").map((entry) => entry.trim()).filter(Boolean)
    : []
} as const;

export const MAX_VIDEO_DURATION_SECONDS = 180;
