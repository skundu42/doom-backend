import { verifySupabaseAccessToken } from "./supabase.js";
function readBearerToken(request) {
    const header = request.headers.authorization;
    if (!header)
        return null;
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
        return null;
    }
    return token.trim();
}
export async function attachAuthUser(request) {
    if (request.authUser)
        return request.authUser;
    const token = readBearerToken(request);
    if (!token)
        return null;
    const user = await verifySupabaseAccessToken(token);
    if (!user)
        return null;
    const authUser = {
        id: user.id,
        email: user.email ?? null,
        userMetadata: user.user_metadata ?? {}
    };
    request.authUser = authUser;
    return authUser;
}
export async function requireAuth(request, reply) {
    const authUser = await attachAuthUser(request);
    if (!authUser) {
        reply.unauthorized("Missing or invalid Supabase access token");
        return;
    }
}
