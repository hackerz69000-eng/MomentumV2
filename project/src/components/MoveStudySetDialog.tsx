import { useEffect, useState } from "react";
import { Check, Folder, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createStudyFolder, fetchStudyFolders, type StudyFolder } from "@/lib/folders";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function MoveStudySetDialog({
  setId,
  setName,
  currentFolderId,
  open,
  onOpenChange,
  onMoved,
}: {
  setId: string;
  setName: string;
  currentFolderId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved?: () => void;
}) {
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [selected, setSelected] = useState<string>(currentFolderId ?? "");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(currentFolderId ?? "");
    void fetchStudyFolders().then(setFolders).catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't load folders"));
  }, [open, currentFolderId]);

  const createFolder = async () => {
    try {
      setBusy(true);
      const folder = await createStudyFolder(newName);
      setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
      setSelected(folder.id);
      setNewName("");
      toast.success(`Created ${folder.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create folder");
    } finally {
      setBusy(false);
    }
  };

  const move = async () => {
    try {
      setBusy(true);
      const { error } = await supabase
        .from("study_sets")
        .update({ folder_id: selected || null, updated_at: new Date().toISOString() })
        .eq("id", setId);
      if (error) throw error;
      toast.success(selected ? "Study set moved" : "Study set moved to Unfiled");
      onOpenChange(false);
      onMoved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't move study set");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move “{setName}”</DialogTitle>
          <DialogDescription>Choose a folder for this study set. Your notes, cards, progress and materials stay intact.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          <button type="button" onClick={() => setSelected("")} className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left ${!selected ? "border-cool2/60 bg-cool/10" : "border-line bg-accent"}`}>
            <Folder className="size-4" /><span className="font-medium">Unfiled</span>{!selected && <Check className="size-4 ml-auto text-cool2" />}
          </button>
          {folders.map((folder) => (
            <button key={folder.id} type="button" onClick={() => setSelected(folder.id)} className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left ${selected === folder.id ? "border-cool2/60 bg-cool/10" : "border-line bg-accent"}`}>
              <Folder className="size-4" /><span className="font-medium truncate">{folder.name}</span>{selected === folder.id && <Check className="size-4 ml-auto text-cool2" />}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createFolder(); } }} placeholder="Create a new folder…" className="flex-1 bg-foreground/5 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-cool2/60" />
          <button type="button" disabled={busy || !newName.trim()} onClick={() => void createFolder()} className="inline-flex items-center gap-2 rounded-lg bg-foreground/5 px-3 py-2 text-sm font-semibold disabled:opacity-50"><FolderPlus className="size-4" />Create</button>
        </div>
        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="px-3 py-2 text-sm">Cancel</button>
          <button type="button" disabled={busy} onClick={() => void move()} className="rounded-lg bg-brand text-ink px-4 py-2 text-sm font-semibold">Move set</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
