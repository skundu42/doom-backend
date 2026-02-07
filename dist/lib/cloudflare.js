import { SignJWT } from "jose";
import { config, MAX_VIDEO_DURATION_SECONDS } from "../config.js";
async function cloudflareRequest(path, init) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${config.cloudflareStreamApiToken}`,
            "Content-Type": "application/json",
            ...(init?.headers ?? {})
        }
    });
    const payload = (await response.json());
    if (!response.ok || !payload.success) {
        const errorText = payload.errors?.map((entry) => entry.message).join("; ") || "Cloudflare API error";
        throw new Error(errorText);
    }
    return payload.result;
}
export async function createDirectVideoUpload(params) {
    const result = await cloudflareRequest("/stream/direct_upload", {
        method: "POST",
        body: JSON.stringify({
            maxDurationSeconds: MAX_VIDEO_DURATION_SECONDS,
            meta: {
                userId: params.userId,
                fileName: params.fileName ?? "",
                mimeType: params.mimeType ?? ""
            }
        })
    });
    return result;
}
export async function getCloudflareVideo(uid) {
    return cloudflareRequest(`/stream/${uid}`);
}
export async function deleteCloudflareVideo(uid) {
    await cloudflareRequest(`/stream/${uid}`, {
        method: "DELETE"
    });
}
export function buildPublicPlaybackHlsUrl(uid) {
    return `${config.cloudflareDeliveryBaseUrl}/${uid}/manifest/video.m3u8`;
}
export function buildPublicPlaybackDashUrl(uid) {
    return `${config.cloudflareDeliveryBaseUrl}/${uid}/manifest/video.mpd`;
}
export function buildPublicThumbnailUrl(uid) {
    return `${config.cloudflareDeliveryBaseUrl}/${uid}/thumbnails/thumbnail.jpg`;
}
export async function buildSignedPlaybackToken(uid) {
    if (!config.cloudflareSigningKeyId || !config.cloudflareSigningKeySecret) {
        return null;
    }
    const now = Math.floor(Date.now() / 1000);
    const secret = new TextEncoder().encode(config.cloudflareSigningKeySecret);
    return new SignJWT({ sub: uid })
        .setProtectedHeader({ alg: "HS256", kid: config.cloudflareSigningKeyId })
        .setIssuedAt(now)
        .setExpirationTime(now + 60 * 10)
        .sign(secret);
}
