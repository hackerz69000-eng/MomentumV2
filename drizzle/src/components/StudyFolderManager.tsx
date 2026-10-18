import { useEffect, useMemo, useState } from "react";
import { Folder, FolderPlus, MoreHorizontal, Pencil, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { fetchStudyFolders, createStudyFolder, renameStudyFolder, deleteStudyFolder, type StudyFolder } from "@/lib/folders";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function StudyFolderManager({
  selectedId,
  onSelect,
  compact = false,
  refreshKey = 0,
}: {
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  compact?: boolean;
  refreshKey?: number;
}) {
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [newName, setNewName] = useState("");
  const [edit, setEdit] = useState<StudyFolder | null>(null);
  const [editName, setEditName] = useState("");
  const [remove, setRemove] = useState<StudyFolder | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setFolders(await fetchStudyFolders()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load folders"); }
  };
  useEffect(() => { void load(); }, [refreshKey]);

  const create = async () => {
    try {
      setBusy(true);
      const folder = await createStudyFolder(newName);
      setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      onSelect?.(folder.id);
      toast.success(`Created ${folder.name}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't create folder"); }
    finally { setBusy(false); }
  };
  const saveRename = async () => {
    if (!edit) return;
    try {
      setBusy(true); await renameStudyFolder(edit.id, editName);
      setFolders((prev) => prev.map((f) => f.id === edit.id ? { ...f, name: editName.trim() } : f).sort((a,b) => a.name.localeCompare(b.name)));
      setEdit(null); toast.success("Folder renamed");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't rename folder"); }
    finally { setBusy(false); }
  };
  const removeFolder = async () => {
    if (!remove) return;
    try {
      setBusy(true); await deleteStudyFolder(remove.id);
      setFolders((prev) => prev.filter((f) => f.id !== remove.id));
      if (selectedId === remove.id) onSelect?.(null);
      setRemove(null); toast.success("Folder deleted. Its study sets are now Unfiled.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete folder"); }
    finally { setBusy(false); }
  };

  const options = useMemo(() => folders, [folders]);
  return <>
    <div className={compact ? "space-y-3" : "rounded-2xl border border-line bg-panel p-5 md:p-6 space-y-4"}>
      {!compact && <div><p className="eyebrow text-cool2">Organization</p><h2 className="font-display text-xl font-bold mt-1">Study folders</h2><p className="text-sm text-soft mt-1">Keep subjects and topics together without changing how your study sets work.</p></div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onSelect?.("__all__")} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${selectedId === "__all__" ? "border-cool2/60 bg-cool/10" : "border-line bg-accent"}`}><Folder className="size-4" /> All folders</button>
        <button type="button" onClick={() => onSelect?.(null)} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${!selectedId ? "border-cool2/60 bg-cool/10" : "border-line bg-accent"}`}><Folder className="size-4" /> Unfiled</button>
        {options.map((f) => <div key={f.id} className={`inline-flex items-center rounded-lg border ${selectedId === f.id ? "border-cool2/60 bg-cool/10" : "border-line bg-accent"}`}>
          <button type="button" onClick={() => onSelect?.(f.id)} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold"><Folder className="size-4" />{f.name}{selectedId === f.id && <Check className="size-3.5 text-cool2" />}</button>
          <button type="button" aria-label={`Folder options for ${f.name}`} onClick={() => { setEdit(f); setEditName(f.name); }} className="p-2 text-soft hover:text-foreground"><MoreHorizontal className="size-4" /></button>
        </div>)}
      </div>
      <div className="flex gap-2 max-w-xl">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void create(); } }} placeholder="New folder — Biology, Calculus, History…" className="flex-1 bg-foreground/5 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-cool2/60" />
        <button type="button" disabled={busy || !newName.trim()} onClick={() => void create()} className="inline-flex items-center gap-2 rounded-lg bg-brand text-ink px-3 py-2 text-sm font-semibold disabled:opacity-50"><FolderPlus className="size-4" />Create</button>
      </div>
    </div>

    <Dialog open={!!edit} onOpenChange={(open) => !open && setEdit(null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit folder</DialogTitle><DialogDescription>Rename this folder without changing any study sets inside it.</DialogDescription></DialogHeader>
        <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={80} className="bg-foreground/5 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-cool2/60" />
        <div className="flex items-center justify-between"><button type="button" onClick={() => { setEdit(null); setRemove(edit); }} className="inline-flex items-center gap-2 text-sm text-destructive"><Trash2 className="size-4" />Delete folder</button><DialogFooter><button type="button" onClick={() => setEdit(null)} className="px-3 py-2 text-sm">Cancel</button><button type="button" disabled={busy || !editName.trim()} onClick={() => void saveRename()} className="rounded-lg bg-brand text-ink px-4 py-2 text-sm font-semibold">Save</button></DialogFooter></div>
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!remove} onOpenChange={(open) => !open && setRemove(null)}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete “{remove?.name}”?</AlertDialogTitle><AlertDialogDescription>The folder will be removed, but your study sets will not be deleted. Any sets inside it will move to <strong>Unfiled</strong>.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => void removeFolder()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete folder</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>;
}
