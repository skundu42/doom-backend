import type { FastifyReply, FastifyRequest } from "fastify";
import { verifySupabaseAccessToken } from "./supabase.js";

function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim();
}

export async function attachAuthUser(request: FastifyRequest) {
  if (request.authUser) return request.authUser;

  const token = readBearerToken(request);
  if (!token) return null;

  const user = await verifySupabaseAccessToken(token);
  if (!user) return null;

  const authUser = {
    id: user.id,
    email: user.email ?? null,
    userMetadata: (user.user_metadata as Record<string, unknown> | null) ?? {}
  };

  request.authUser = authUser;
  return authUser;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authUser = await attachAuthUser(request);
  if (!authUser) {
    reply.unauthorized("Missing or invalid Supabase access token");
    return;
  }
}
