import { supabase } from "@/integrations/supabase/client";
export { assertGenerationClaimed, assertGenerationSourceRevision } from "./study-generation-guards";

export function newStudyGenerationToken(): string {
  return crypto.randomUUID();
}

export async function releaseStudyGeneration(
  setId: string,
  lockToken: string,
  error: string | null = null,
  markSetError = false,
): Promise<void> {
  await supabase.rpc("release_study_set_generation", {
    p_set_id: setId,
    p_lock_token: lockToken,
    p_error: error,
    p_mark_set_error: markSetError,
  });
}

/** Renews the DB lease while this browser is actively streaming generation. */
export function startStudyGenerationHeartbeat(
  setId: string,
  lockToken: string,
  onLeaseLost: () => void,
): () => void {
  let stopped = false;
  let inFlight = false;
  const heartbeat = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const { data, error } = await supabase.rpc("renew_study_set_generation", {
        p_set_id: setId,
        p_lock_token: lockToken,
      });
      if (!stopped && !error && data !== true) onLeaseLost();
    } catch {
      // A transient connection problem does not prove another tab owns the lease;
      // the final database commit remains authoritative.
    } finally {
      inFlight = false;
    }
  };
  const timer = window.setInterval(() => void heartbeat(), 30_000);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
