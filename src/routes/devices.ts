import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth.js";
import { ensureProfile } from "../lib/profiles.js";
import { supabaseAdmin } from "../lib/supabase.js";

const registerDeviceSchema = z
  .object({
    platform: z.enum(["ios", "android"]),
    token: z.string().trim().min(16).max(4096)
  })
  .strict();

export async function registerDeviceRoutes(fastify: FastifyInstance) {
  fastify.register(async (app) => {
    app.post("/push-token", { preHandler: requireAuth }, async (request, reply) => {
      const parsed = registerDeviceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const profile = await ensureProfile(request);
      await supabaseAdmin
        .from("device_tokens")
        .upsert({
          user_id: profile.id,
          platform: parsed.data.platform,
          token: parsed.data.token,
          updated_at: new Date().toISOString()
        });

      return { ok: true };
    });
  }, { prefix: "/v1/devices" });
}
