import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config, MAX_VIDEO_DURATION_SECONDS } from "../config.js";
import { deleteCloudflareVideo } from "../lib/cloudflare.js";
import { supabaseAdmin } from "../lib/supabase.js";

const streamWebhookSchema = z
  .object({
    uid: z.string().min(4).max(64),
    readyToStream: z.boolean().optional(),
    duration: z.coerce.number().nonnegative().optional(),
    status: z
      .object({
        state: z.string().optional()
      })
      .partial()
      .optional()
  })
  .passthrough();

function verifyWebhookSecret(headerValue: string | undefined) {
  if (!config.cloudflareWebhookSecret) return true;
  return headerValue === config.cloudflareWebhookSecret;
}

export async function registerWebhookRoutes(fastify: FastifyInstance) {
  fastify.register(async (app) => {
    app.post("/cloudflare/stream", async (request, reply) => {
      const webhookSecret = request.headers["webhook-auth"];
      const headerValue = Array.isArray(webhookSecret) ? webhookSecret[0] : webhookSecret;
      if (!verifyWebhookSecret(headerValue)) {
        return reply.unauthorized("Invalid Cloudflare webhook secret");
      }

      const parsed = streamWebhookSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const body = parsed.data;
      const durationSeconds = Math.round(body.duration ?? 0);

      if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
        await deleteCloudflareVideo(body.uid);
      }

      await supabaseAdmin
        .from("video_uploads")
        .update({
          status: body.status?.state ?? (body.readyToStream ? "ready" : "processing"),
          duration_seconds: durationSeconds > 0 ? durationSeconds : null,
          updated_at: new Date().toISOString()
        })
        .eq("uid", body.uid);

      return { ok: true };
    });
  }, { prefix: "/v1/webhooks" });
}
