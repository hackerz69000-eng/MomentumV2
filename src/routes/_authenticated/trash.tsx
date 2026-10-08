import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KEEP_DAYS, purgeItem, restoreItem, type TrashItem } from "@/lib/trash";
import { PageHeader } from "@/components/PageHeader";
import { btnGhost } from "@/components/set/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/trash")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Recently Deleted — Momentum" },
      {
        name: "description",
        content:
          "Restore study sets, flashcards, lectures, files and notes you deleted in the last 30 days.",
      },
      { property: "og:title", content: "Recently Deleted — Momentum" },
      { property: "og:description", content: "Restore recently deleted study content." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrashPage,
});

const KIND: Record<string, string> = {
  set: "Study set",
  flashcard: "Flashcard",
  flashcards: "Flashcards",
  lecture: "Lecture",
  file: "File",
  notes: "Notes",
};

function TrashPage() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<TrashItem | null>(null);
  const q = useQuery({
    queryKey: ["trash"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trash")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const items = (data ?? []) as TrashItem[];
      const cutoff = Date.now() - KEEP_DAYS * 864e5;
      const expired = items.filter((i) => new Date(i.created_at).getTime() < cutoff);
      expiredRef.current = expired;
      return items.filter((i) => !expired.includes(i));
    },
  });
  const expiredRef = useRef<TrashItem[]>([]);
  const purged = useRef(new Set<string>());
  useEffect(() => {
    for (const i of expiredRef.current) {
      if (purged.current.has(i.id)) continue;
      purged.current.add(i.id);
      purgeItem(i).catch(() => purged.current.delete(i.id));
    }
  }, [q.data]);

  const restore = async (i: TrashItem) => {
    setBusy(i.id);
    try {
      await restoreItem(i);
      toast.success(`${KIND[i.kind] ?? "Item"} restored`);
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't restore");
    }
    setBusy(null);
  };
  const purge = async (i: TrashItem) => {
    setBusy(i.id);
    try {
      await purgeItem(i);
      toast.success("Deleted permanently");
    } catch {
      toast.error("Couldn't delete permanently. Try again.");
    }
    qc.invalidateQueries({ queryKey: ["trash"] });
    setBusy(null);
  };

  return (
    <main className="flex-1 min-w-0">
      <PageHeader
        title="Recently Deleted"
        sub={`Deleted items stay here for ${KEEP_DAYS} days, then they're removed for good.`}
      />
      <div className="p-5 md:p-8 max-w-3xl space-y-3">
        {q.isLoading && <Loader2 className="size-6 animate-spin text-cool2" />}
        {q.data?.length === 0 && (
          <p className="text-sm text-soft">
            Nothing here. Deleted study sets, flashcards, lectures, files and replaced notes will
            show up here.
          </p>
        )}
        {q.data?.map((i) => {
          const left = Math.max(
            0,
            KEEP_DAYS - Math.floor((Date.now() - new Date(i.created_at).getTime()) / 864e5),
          );
          return (
            <div
              key={i.id}
              className="rounded-2xl bg-panel border border-line/70 p-4 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="eyebrow text-cool2">{KIND[i.kind] ?? i.kind}</p>
                <p className="font-semibold truncate">{i.label}</p>
                <p className="text-xs text-soft">
                  Deleted {new Date(i.created_at).toLocaleString()} · {left} days left
                </p>
              </div>
              <div className="flex gap-2">
                <button disabled={busy === i.id} onClick={() => restore(i)} className={btnGhost}>
                  {busy === i.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}{" "}
                  Restore
                </button>
                <button
                  disabled={busy === i.id}
                  onClick={() => setConfirmItem(i)}
                  className="text-xs text-soft hover:text-destructive inline-flex items-center gap-1 px-2"
                >
                  <Trash2 className="size-3" /> Delete forever
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <AlertDialog open={!!confirmItem} onOpenChange={(o) => !o && setConfirmItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmItem?.label}" will be gone for good, including any saved files or audio. This
              can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmItem && purge(confirmItem)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
