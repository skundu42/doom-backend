import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { supabaseAdmin, unwrapData, unwrapOptionalData } from "./supabase.js";

export type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  is_creator: boolean;
  links: string[] | null;
  interests: string[] | null;
  created_at: string;
  updated_at: string;
};

function sanitizeHandle(input: string) {
  const cleaned = input.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return cleaned.slice(0, 24);
}

function fallbackHandle(request: FastifyRequest) {
  const emailPrefix = request.authUser?.email?.split("@")[0] ?? "user";
  const metadataHandle = request.authUser?.userMetadata.username;
  const source = typeof metadataHandle === "string" ? metadataHandle : emailPrefix;
  const normalized = sanitizeHandle(source);
  if (normalized.length >= 3) return normalized;
  return `user_${randomUUID().slice(0, 8)}`;
}

function fallbackDisplayName(request: FastifyRequest) {
  const metadataName = request.authUser?.userMetadata.full_name;
  if (typeof metadataName === "string" && metadataName.trim().length > 0) {
    return metadataName.trim().slice(0, 80);
  }
  return request.authUser?.email?.split("@")[0] ?? "Doomscroll User";
}

async function fetchProfile(userId: string) {
  const result = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  return unwrapOptionalData<ProfileRow>(result);
}

export async function ensureProfile(request: FastifyRequest) {
  const userId = request.authUser?.id;
  if (!userId) {
    throw new Error("Missing authenticated user context");
  }

  const existing = await fetchProfile(userId);
  if (existing) {
    return existing;
  }

  const usernameBase = fallbackHandle(request);

  for (let index = 0; index < 5; index += 1) {
    const username = index === 0 ? usernameBase : `${usernameBase.slice(0, 18)}_${randomUUID().slice(0, 4)}`;
    const insertResult = await supabaseAdmin
      .from("profiles")
      .insert({
        id: userId,
        username,
        display_name: fallbackDisplayName(request),
        is_creator: true,
        links: [],
        interests: []
      })
      .select("*")
      .single();

    if (!insertResult.error && insertResult.data) {
      return insertResult.data as ProfileRow;
    }

    // 23505 = unique violation (username conflict). retry with a suffix.
    if (insertResult.error?.code !== "23505") {
      throw new Error(insertResult.error?.message ?? "Unable to create profile");
    }
  }

  const profile = await fetchProfile(userId);
  if (profile) return profile;

  throw new Error("Unable to create profile");
}

export async function updateOwnProfile(userId: string, patch: Partial<ProfileRow>) {
  const result = await supabaseAdmin
    .from("profiles")
    .update({
      ...patch,
      updated_at: new Date().toISOString()
    })
    .eq("id", userId)
    .select("*")
    .single();

  return unwrapData<ProfileRow>(result, "Failed to update profile");
}

export async function fetchProfilesByIds(ids: string[]) {
  if (ids.length === 0) return new Map<string, ProfileRow>();

  const result = await supabaseAdmin
    .from("profiles")
    .select("*")
    .in("id", ids);

  const rows = unwrapData<ProfileRow[]>(
    result as { data: ProfileRow[] | null; error: { message: string } | null },
    "Failed to load profiles"
  );

  return new Map(rows.map((row) => [row.id, row]));
}
