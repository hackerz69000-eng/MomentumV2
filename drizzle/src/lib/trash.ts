// Recently Deleted: deletions snapshot rows into `trash` first, so they can be restored with the same ids.
import { supabase } from "@/integrations/supabase/client";

export type TrashKind = "set" | "flashcard" | "flashcards" | "lecture" | "file" | "notes";
const CHILDREN = [
  "flashcards",
  "quiz_attempts",
  "study_files",
  "lectures",
  "mistakes",
  "tutor_messages",
  "material_messages",
] as const;
export const KEEP_DAYS = 30;
const sb = supabase as any;

async function put(kind: TrashKind, label: string, setId: string | null, data: unknown) {
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user?.id) throw new Error("Please sign in again before changing saved items.");
  const { error } = await sb
    .from("trash")
    .insert({ user_id: auth.user.id, kind, label, set_id: setId, data });
  if (error)
    throw new Error(
      "Couldn't move this to Recently Deleted, so nothing was deleted. Please try again.",
    );
}

export async function trashSet(setId: string) {
  const { data: set } = await sb.from("study_sets").select("*").eq("id", setId).single();
  if (!set) throw new Error("Study set not found");
  const children: Record<string, unknown[]> = {};
  for (const t of CHILDREN) {
    const { data, error } = await sb.from(t).select("*").eq("set_id", setId);
    if (error) throw new Error("Couldn't safely back up every item in this study set. Nothing was deleted.");
    children[t] = data ?? [];
  }
  const { data: activityRows, error: activityError } = await sb.from("study_activity").select("id").eq("set_id", setId);
  if (activityError) throw new Error("Couldn't safely back up study history. Nothing was deleted.");
  const activity = (activityRows ?? []).map((r: { id: string }) => r.id);
  await put("set", set.name, setId, { set, children, activity });
  const { error } = await sb.from("study_sets").delete().eq("id", setId);
  if (error) throw new Error("Couldn't delete the study set");
}

export async function trashRow(
  kind: "flashcard" | "lecture" | "file",
  table: string,
  row: { id: string; set_id: string | null },
  label: string,
) {
  await put(kind, label, row.set_id, { row });
  const { error } = await sb.from(table).delete().eq("id", row.id);
  if (error) throw new Error("Couldn't delete this item");
}

export type TrashItem = {
  id: string;
  kind: TrashKind;
  label: string;
  set_id: string | null;
  data: any;
  created_at: string;
};

const TABLE: Record<string, string> = {
  flashcard: "flashcards",
  lecture: "lectures",
  file: "study_files",
};

export async function restoreItem(item: TrashItem) {
  const d = item.data;
  const needSet = async () => {
    if (!item.set_id) return;
    const { data } = await sb.from("study_sets").select("id").eq("id", item.set_id).maybeSingle();
    if (!data) throw new Error("Restore its study set first (it's also in Recently Deleted).");
  };
  if (item.kind === "set") {
    const { error } = await sb.from("study_sets").upsert(d.set);
    if (error) throw new Error("Couldn't restore the study set");
    for (const t of CHILDREN) {
      const rows = d.children?.[t] ?? [];
      if (rows.length) {
        const { error } = await sb.from(t).upsert(rows, { defaultToNull: false });
        if (error) throw new Error(`The study set was restored, but its ${t.replaceAll("_", " ")} could not be fully restored. The backup remains in Recently Deleted.`);
      }
    }
    if (d.activity?.length) {
      const { error } = await sb.from("study_activity").update({ set_id: d.set.id }).in("id", d.activity);
      if (error) throw new Error("The study set was restored, but some study history could not be restored. The backup remains in Recently Deleted.");
    }
  } else if (item.kind === "notes") {
    await needSet();
    const { data: cur } = await sb
      .from("study_sets")
      .select("notes, name")
      .eq("id", item.set_id)
      .single();
    if (cur?.notes?.trim())
      await put("notes", `Previous notes — ${cur.name}`, item.set_id, { notes: cur.notes });
    const { error: saveError } = await sb.from("study_sets").update({ notes: d.notes }).eq("id", item.set_id);
    if (saveError) throw new Error("Couldn't restore the previous notes. The backup remains in Recently Deleted.");
  } else if (item.kind === "flashcards") {
    await needSet();
    const { error } = await sb.from("flashcards").upsert(d.rows, { defaultToNull: false });
    if (error) throw new Error("Couldn't restore the flashcards");
  } else {
    await needSet();
    const { error } = await sb.from(TABLE[item.kind]).upsert(d.row, { defaultToNull: false });
    if (error) throw new Error("Couldn't restore this item");
  }
  const { error: removeBackupError } = await sb.from("trash").delete().eq("id", item.id);
  if (removeBackupError) throw new Error("The item was restored, but its backup could not be cleared. You can safely retry after refreshing.");
}

/** Permanent delete, including stored files that only the trashed item referenced. */
export async function purgeItem(item: TrashItem) {
  const paths: string[] = [];
  if (item.kind === "file") paths.push(item.data.row.path);
  if (item.kind === "lecture") paths.push(...(item.data.row.audio_paths ?? []));
  if (item.kind === "set") {
    for (const f of item.data.children?.study_files ?? []) paths.push(f.path);
    for (const l of item.data.children?.lectures ?? []) paths.push(...(l.audio_paths ?? []));
  }
  if (paths.length) {
    const { error } = await supabase.storage.from("study-files").remove(paths);
    if (error) throw new Error("Couldn't remove the stored file. The Recently Deleted item was kept so you can retry.");
  }
  const { error } = await sb.from("trash").delete().eq("id", item.id);
  if (error) throw new Error("Couldn't permanently delete this item. Please try again.");
}
