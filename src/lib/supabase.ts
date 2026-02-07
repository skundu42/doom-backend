import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

export async function verifySupabaseAccessToken(accessToken: string) {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) {
    return null;
  }
  return data.user;
}

export function unwrapData<T>(
  result: { data: T | null; error: { message: string } | null },
  fallbackMessage: string
): T {
  if (result.error || result.data == null) {
    throw new Error(result.error?.message ?? fallbackMessage);
  }
  return result.data;
}

export function unwrapOptionalData<T>(
  result: { data: T | null; error: { code?: string; message: string } | null },
  knownEmptyCodes: string[] = ["PGRST116"]
): T | null {
  if (result.error) {
    if (knownEmptyCodes.includes(result.error.code ?? "")) {
      return null;
    }
    throw new Error(result.error.message);
  }
  return result.data;
}
