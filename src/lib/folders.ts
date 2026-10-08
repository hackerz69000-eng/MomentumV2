import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type StudyFolder = Tables<"study_folders">;

export async function fetchStudyFolders(): Promise<StudyFolder[]> {
  const { data, error } = await supabase
    .from("study_folders")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as StudyFolder[];
}

export async function createStudyFolder(name: string): Promise<StudyFolder> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("Give the folder a name.");
  if (clean.length > 80) throw new Error("Folder names can be up to 80 characters.");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Please sign in again.");
  const { data, error } = await supabase
    .from("study_folders")
    .insert({ user_id: auth.user.id, name: clean })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("You already have a folder with that name.");
    throw error;
  }
  return data as StudyFolder;
}

export async function renameStudyFolder(id: string, name: string) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("Give the folder a name.");
  const { error } = await supabase
    .from("study_folders")
    .update({ name: clean, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") throw new Error("You already have a folder with that name.");
    throw error;
  }
}

export async function deleteStudyFolder(id: string) {
  // ON DELETE SET NULL deliberately keeps every study set safe and puts it in Unfiled.
  const { error } = await supabase.from("study_folders").delete().eq("id", id);
  if (error) throw error;
}
