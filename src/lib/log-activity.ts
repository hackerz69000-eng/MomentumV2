import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";
import type { Json } from "@/integrations/supabase/types";
import type { ActivityKind } from "./activity";

type Extra = { score?: number; total?: number; duration_seconds?: number; meta?: Json };

/** Records a completed study activity (feeds history, streaks, achievements, plans and the Coach). Failures are silent. */
export async function logActivity(
  kind: ActivityKind,
  setId: string | null,
  count = 1,
  qc?: QueryClient,
  extra: Extra = {},
) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase
    .from("study_activity")
    .insert({ user_id: data.user.id, set_id: setId, kind, count, ...extra });
  qc?.invalidateQueries({ queryKey: ["activity"] });
}
