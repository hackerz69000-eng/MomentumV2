/** Small DB-backed lock for expensive AI jobs. It prevents double-clicks and parallel tabs
 * from spending twice on the same set/action without imposing a visible AI quota on students. */
export async function withGenerationLock<T>(
  supabase: any,
  userId: string,
  setId: string | null,
  action: string,
  work: () => Promise<T>,
): Promise<T> {
  const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await supabase
    .from("ai_generation_locks")
    .delete()
    .eq("user_id", userId)
    .eq("action", action)
    .lt("created_at", stale);
  const { data: lock, error } = await supabase
    .from("ai_generation_locks")
    .insert({ user_id: userId, set_id: setId, action })
    .select("id")
    .maybeSingle();
  if (error || !lock) throw new Error("This generation is already running. Please wait for it to finish.");
  try {
    return await work();
  } finally {
    await supabase.from("ai_generation_locks").delete().eq("id", lock.id).eq("user_id", userId);
  }
}
