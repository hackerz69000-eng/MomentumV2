import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/integrations/supabase/url";

const KEEP_DAYS = 30;
const MAX_ITEMS = 100;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/cleanup-trash")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"]?.trim();
        const auth = request.headers.get("authorization") ?? "";
        if (!secret || auth !== `Bearer ${secret}`) return json({ error: "Unauthorized" }, 401);
        const url = normalizeSupabaseUrl(process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "");
        const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
        if (!url || !serviceKey) return json({ error: "Cleanup service is not configured." }, 500);
        const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
        const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
        const { data: items, error } = await admin.from("trash").select("*").lt("created_at", cutoff).order("created_at", { ascending: true }).limit(MAX_ITEMS);
        if (error) return json({ error: error.message }, 500);
        let cleaned = 0;
        for (const item of items ?? []) {
          const paths: string[] = [];
          if (item.kind === "file") paths.push(item.data?.row?.path);
          if (item.kind === "lecture") paths.push(...(item.data?.row?.audio_paths ?? []));
          if (item.kind === "set") {
            for (const f of item.data?.children?.study_files ?? []) if (f.path) paths.push(f.path);
            for (const l of item.data?.children?.lectures ?? []) paths.push(...(l.audio_paths ?? []));
            for (const a of item.data?.children?.audio_study_sessions ?? []) paths.push(...(a.audio_paths ?? []));
          }
          const validPaths = paths.filter(Boolean);
          if (validPaths.length) {
            const { error: storageError } = await admin.storage.from("study-files").remove(validPaths);
            if (storageError) continue;
          }
          const { error: deleteError } = await admin.from("trash").delete().eq("id", item.id);
          if (!deleteError) cleaned++;
        }
        return json({ cleaned, remaining: Math.max(0, (items?.length ?? 0) - cleaned) });
      },
    },
  },
});
