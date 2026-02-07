import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth.js";
import {
  buildPublicPlaybackDashUrl,
  buildPublicPlaybackHlsUrl,
  buildPublicThumbnailUrl,
  buildSignedPlaybackToken,
  createDirectVideoUpload,
  deleteCloudflareVideo,
  getCloudflareVideo
} from "../lib/cloudflare.js";
import { ensureProfile } from "../lib/profiles.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { MAX_VIDEO_DURATION_SECONDS } from "../config.js";

const directUploadSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255).optional(),
    mimeType: z.string().trim().min(1).max(255).optional()
  })
  .strict();

export async function registerMediaRoutes(fastify: FastifyInstance) {
  fastify.register(async (app) => {
    app.post("/video/direct-upload", { preHandler: requireAuth }, async (request, reply) => {
      const parsed = directUploadSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const profile = await ensureProfile(request);
      const upload = await createDirectVideoUpload({
        userId: profile.id,
        fileName: parsed.data.fileName,
        mimeType: parsed.data.mimeType
      });

      await supabaseAdmin
        .from("video_uploads")
        .upsert({
          uid: upload.uid,
          user_id: profile.id,
          status: "pending"
        });

      return {
        uid: upload.uid,
        uploadUrl: upload.uploadURL,
        maxDurationSeconds: MAX_VIDEO_DURATION_SECONDS
      };
    });

    app.get("/video/:uid/status", { preHandler: requireAuth }, async (request, reply) => {
      const uid = (request.params as { uid: string }).uid;
      const authUser = request.authUser;
      if (!authUser) {
        return reply.unauthorized("Missing authenticated user context");
      }
      const video = await getCloudflareVideo(uid);
      const durationSeconds = Math.round(video.duration ?? 0);

      if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
        // Hard backstop: remove assets over policy length.
        await deleteCloudflareVideo(uid);
        return reply.unprocessableEntity("Video exceeds 3-minute limit");
      }

      const signedToken = await buildSignedPlaybackToken(uid);

      await supabaseAdmin
        .from("video_uploads")
        .upsert({
          uid,
          user_id: authUser.id,
          status: video.status?.state ?? (video.readyToStream ? "ready" : "processing"),
          duration_seconds: durationSeconds > 0 ? durationSeconds : null,
          updated_at: new Date().toISOString()
        });

      return {
        uid,
        readyToStream: Boolean(video.readyToStream),
        durationSeconds: durationSeconds > 0 ? durationSeconds : null,
        state: video.status?.state ?? null,
        playback: {
          hls: buildPublicPlaybackHlsUrl(uid),
          dash: buildPublicPlaybackDashUrl(uid),
          thumbnail: buildPublicThumbnailUrl(uid),
          signedToken
        }
      };
    });
  }, { prefix: "/v1/media" });
}
