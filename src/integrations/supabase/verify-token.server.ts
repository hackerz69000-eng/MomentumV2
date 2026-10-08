import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function getSupabaseConfig() {
  const url = process.env["SUPABASE_URL"] || "https://placeholder-project.supabase.co";
  const key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder";

  return { url, key };
}

/**
 * Validate a bearer access token against Supabase Auth.
 *
 * getUser(token) performs the authoritative server-side validation against the
 * configured Supabase project. Do not treat a decoded JWT as authenticated.
 */
export async function verifySupabaseAccessToken(token: string) {
  if (!token) return null;

  const { url, key } = getSupabaseConfig();
  const client = createClient<Database>(url, key, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.id) return null;

  return data.user;
}
