import { z } from "zod";
import { requireAuth } from "../lib/auth.js";
import { createDirectVideoUpload, deleteCloudflareVideo, getCloudflareVideoDelivery } from "../lib/cloudflare.js";
import { ensureProfile } from "../lib/profiles.js";
import { supabaseAdmin, unwrapOptionalData } from "../lib/supabase.js";
import { MAX_VIDEO_DURATION_SECONDS } from "../config.js";
const directUploadSchema = z
    .object({
    fileName: z.string().trim().min(1).max(255).optional(),
    mimeType: z.string().trim().min(1).max(255).optional()
})
    .strict();
const uidParamSchema = z
    .object({
    uid: z.string().trim().min(4).max(64)
})
    .strict();
async function loadVideoUpload(uid) {
    const result = await supabaseAdmin
        .from("video_uploads")
        .select("uid,user_id,status,duration_seconds,updated_at")
        .eq("uid", uid)
        .maybeSingle();
    return unwrapOptionalData(result);
}
function verifyUploadOwnership(existingUpload, requestUserId) {
    if (!existingUpload)
        return false;
    return existingUpload.user_id === requestUserId;
}
async function persistVideoUploadStatus(params) {
    const upsertResult = await supabaseAdmin
        .from("video_uploads")
        .upsert({
        uid: params.uid,
        user_id: params.userId,
        status: params.state,
        duration_seconds: params.durationSeconds,
        updated_at: new Date().toISOString()
    });
    if (upsertResult.error) {
        throw new Error(upsertResult.error.message);
    }
}
export async function registerMediaRoutes(fastify) {
    fastify.register(async (app) => {
        const handleVideoRead = async (request, reply) => {
            const parsedParams = uidParamSchema.safeParse(request.params);
            if (!parsedParams.success) {
                return reply.status(400).send({ error: parsedParams.error.flatten() });
            }
            const uid = parsedParams.data.uid;
            const authUser = request.authUser;
            if (!authUser) {
                return reply.unauthorized("Missing authenticated user context");
            }
            const existingUpload = await loadVideoUpload(uid);
            if (!existingUpload) {
                return reply.notFound("Video upload not found");
            }
            if (!verifyUploadOwnership(existingUpload, authUser.id)) {
                return reply.forbidden("Video upload does not belong to current user");
            }
            const { video, signedToken, playback } = await getCloudflareVideoDelivery(uid);
            const durationSeconds = Math.round(video.duration ?? 0);
            if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
                // Hard backstop: remove assets over policy length.
                await deleteCloudflareVideo(uid);
                return reply.unprocessableEntity("Video exceeds 3-minute limit");
            }
            const state = video.status?.state ?? (video.readyToStream ? "ready" : "processing");
            await persistVideoUploadStatus({
                uid,
                userId: authUser.id,
                state,
                durationSeconds: durationSeconds > 0 ? durationSeconds : null
            });
            return {
                uid,
                readyToStream: Boolean(video.readyToStream),
                durationSeconds: durationSeconds > 0 ? durationSeconds : null,
                state,
                errorReasonCode: video.status?.errorReasonCode ?? null,
                errorReasonText: video.status?.errorReasonText ?? null,
                playback: {
                    hls: playback.hls,
                    dash: playback.dash,
                    thumbnail: playback.thumbnail,
                    signedToken
                }
            };
        };
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
            const upsertResult = await supabaseAdmin
                .from("video_uploads")
                .upsert({
                uid: upload.uid,
                user_id: profile.id,
                status: "pending"
            });
            if (upsertResult.error) {
                throw new Error(upsertResult.error.message);
            }
            return {
                uid: upload.uid,
                uploadUrl: upload.uploadURL,
                maxDurationSeconds: MAX_VIDEO_DURATION_SECONDS
            };
        });
        app.get("/video/:uid", { preHandler: requireAuth }, handleVideoRead);
        app.get("/video/:uid/status", { preHandler: requireAuth }, handleVideoRead);
    }, { prefix: "/v1/media" });
}
