/**
 * Supabase clients must receive the bare project URL, e.g.
 * https://your-project.supabase.co
 *
 * People sometimes copy the REST endpoint (/rest/v1) or another API path
 * from the Supabase dashboard. Strip that path so supabase-js can append
 * its own REST/Auth/Storage paths correctly.
 */
export function normalizeSupabaseUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return raw;

  try {
    const url = new URL(raw);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/\/(?:rest\/v1|auth\/v1|storage\/v1)(?:\/.*)?\/?$/, "");
  }
}
