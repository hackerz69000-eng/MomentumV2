import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, Pencil, Plus, Shuffle, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { prepareRegenerateCardsStream, saveRegenerateCardsStream } from "@/lib/study.functions";
import { streamAiJson } from "@/lib/ai-stream";
import { trashRow } from "@/lib/trash";
import { cardStats, isDue, schedule, shuffle, type Flashcard, type Rating } from "@/lib/stats";
import { useAuth } from "@/hooks/use-auth";
import { logActivity } from "@/lib/log-activity";
import { updateLocalCardStatus } from "@/lib/local-store";
import { recordStudySessionCompletion } from "@/components/DailyStreak";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { btnGhost, btnPrimary, inputCls, Stat } from "./ui";

type Mode = "due" | "all";

/** Smart order: cards from shaky topics, with more lapses and most overdue come first. */
function prioritize(due: Flashcard[], all: Flashcard[]) {
  const topicMiss = new Map<string, number>();
  for (const c of all)
    if (c.topic)
      topicMiss.set(
        c.topic,
        (topicMiss.get(c.topic) ?? 0) + c.lapses + (c.status === "known" ? 0 : 0.5),
      );
  const now = Date.now();
  const score = (c: Flashcard) =>
    c.lapses * 3 +
    (c.topic ? (topicMiss.get(c.topic) ?? 0) : 0) +
    Math.min(10, (now - Date.parse(c.due_at)) / 86400000) +
    (c.reps === 0 ? 1 : 0);
  return [...due].sort((a, b) => score(b) - score(a));
}

export function Flashcards({ setId, cards }: { setId: string; cards: Flashcard[] }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const prepareRegen = useServerFn(prepareRegenerateCardsStream);
  const saveRegen = useServerFn(saveRegenerateCardsStream);
  const stats = cardStats(cards);
  const [mode, setMode] = useState<Mode>(stats.due > 0 ? "due" : "all");
  const [order, setOrder] = useState<string[] | null>(null);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [clozeResponse, setClozeResponse] = useState("");
  const [clozeChecked, setClozeChecked] = useState(false);
  const [clozeRevealed, setClozeRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streamedJson, setStreamedJson] = useState("");
  const streamController = useRef<AbortController | null>(null);
  const [editing, setEditing] = useState<Flashcard | "new" | null>(null);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const deckIds = useMemo(() => {
    if (order) return order.filter((id) => byId.has(id));
    const base =
      mode === "due"
        ? prioritize(
            cards.filter((c) => isDue(c)),
            cards,
          )
        : cards;
    return base.map((c) => c.id);
  }, [order, mode, cards, byId]);
  const idx = i;
  const card = deckIds[idx] ? byId.get(deckIds[idx]!) : undefined;
  const clozeMatch = card?.card_type === "cloze" ? card.question.match(/\{\{c1::(.+?)\}\}/) : null;
  const clozeTarget = clozeMatch?.[1] ?? "";
  const normalizeCloze = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s.,!?;:]+$/g, "");
  const clozeIsCorrect = !!clozeTarget && normalizeCloze(clozeResponse) === normalizeCloze(clozeTarget);

  useEffect(() => {
    setClozeResponse("");
    setClozeChecked(false);
    setClozeRevealed(false);
    setFlipped(false);
  }, [card?.id]);

  // Retry locally queued reviews when the user returns or connectivity recovers.
  useEffect(() => {
    if (!user?.id || typeof window === "undefined") return;
    const queueKey = `momentum_pending_flashcard_reviews_v1:${user.id}`;
    const retryPending = async () => {
      if (!navigator.onLine) return;
      let queue: Record<string, { cardId: string; patch: Partial<Flashcard>; setId: string }> = {};
      try { queue = JSON.parse(localStorage.getItem(queueKey) ?? "{}"); } catch { return; }
      for (const [id, item] of Object.entries(queue)) {
        try {
          const { data, error } = await supabase.from("flashcards").update(item.patch).eq("id", id).eq("user_id", user.id).select("id");
          if (error || !data?.length) continue;
          delete queue[id];
          localStorage.setItem(queueKey, JSON.stringify(queue));
          if (item.setId === setId) {
            qc.setQueryData<Flashcard[]>(["cards", setId], (old) => old?.map((c) => c.id === id ? { ...c, ...item.patch } : c));
          }
        } catch { /* leave it queued for the next retry */ }
      }
    };
    window.addEventListener("online", retryPending);
    window.addEventListener("focus", retryPending);
    void retryPending();
    return () => { window.removeEventListener("online", retryPending); window.removeEventListener("focus", retryPending); };
  }, [user?.id, setId, qc]);

  const startDeck = (m: Mode, shuffled = false) => {
    const base =
      m === "due"
        ? prioritize(
            cards.filter((c) => isDue(c)),
            cards,
          )
        : cards;
    const ids = base.map((c) => c.id);
    setMode(m);
    setOrder(shuffled ? shuffle(ids) : ids);
    setI(0);
    setFlipped(false);
  };

  const go = (d: number) => {
    if (!deckIds.length) return;
    setFlipped(false);
    setI((x) => (x + d + deckIds.length) % deckIds.length);
  };

  const rate = async (r: Rating) => {
    if (!card) return;
    const patch = schedule(card, r);
    const ids = order ?? deckIds;
    // "Again" cards come back at the end of this session, so the session is
    // not complete until the re-queued cards have also been reviewed.
    const nextOrder = r === "again" ? [...ids, card.id] : ids;
    const nextIndex = i + 1;
    setOrder(nextOrder);
    qc.setQueryData<Flashcard[]>(["cards", setId], (old) =>
      old?.map((c) => (c.id === card.id ? { ...c, ...patch } : c)),
    );
    setFlipped(false);
    setI(nextIndex);

    // Save full SRS patch in local store
    updateLocalCardStatus(card.id, patch);

    // Only log completion after the full review queue (including Again cards)
    // has been exhausted.
    if (nextIndex >= nextOrder.length) {
      recordStudySessionCompletion(15, `Flashcards (${cards.length} cards)`);
      toast.success("Flashcard review completed. Complete all five distinct daily tasks to earn streak credit.");
    }

    let savedRemotely = false;
    const queueKey = `momentum_pending_flashcard_reviews_v1:${user?.id ?? "anonymous"}`;
    const queuePatch = () => {
      try {
        const raw = localStorage.getItem(queueKey);
        const queue = raw ? JSON.parse(raw) as Record<string, { cardId: string; patch: typeof patch; setId: string }> : {};
        // Latest review state wins per card, preventing duplicate/reordered retries.
        queue[card.id] = { cardId: card.id, patch, setId };
        localStorage.setItem(queueKey, JSON.stringify(queue));
      } catch (queueError) {
        console.error("[flashcards] Could not queue pending review:", queueError);
      }
    };
    try {
      if (!user?.id) throw new Error("Sign in is required to sync flashcard reviews.");
      const { data: savedRows, error } = await supabase
        .from("flashcards")
        .update(patch)
        .eq("id", card.id)
        .eq("user_id", user.id)
        .select("id");
      if (error) throw error;
      if (!savedRows?.length) throw new Error("The cloud did not confirm this card update (ownership or row policy may have blocked it).");
      savedRemotely = true;
      // Remove a pending offline copy only after the server confirms this exact card.
      try {
        const raw = localStorage.getItem(queueKey);
        const queue = raw ? JSON.parse(raw) as Record<string, unknown> : {};
        delete queue[card.id];
        localStorage.setItem(queueKey, JSON.stringify(queue));
      } catch { /* optional queue cleanup */ }
      void logActivity("flashcard", setId, 1, qc);
    } catch (error) {
      queuePatch();
      const message = error instanceof Error ? error.message : "Unknown cloud sync error";
      console.error("[flashcards] Review save failed:", message);
      toast.error(`Review saved locally; cloud sync failed: ${message}. It will retry when you return online.`);
    }
    // Only read server state after a confirmed write. Pending local reviews are
    // retried on the next review, focus, or reconnect and never overwritten here.
    if (savedRemotely) {
      await qc.invalidateQueries({ queryKey: ["cards", setId] });
      await qc.invalidateQueries({ queryKey: ["sets"] });
    }
  };

  const del = async (c: Flashcard) => {
    qc.setQueryData<Flashcard[]>(["cards", setId], (old) => old?.filter((x) => x.id !== c.id));
    try {
      await trashRow(
        "flashcard",
        "flashcards",
        c as never,
        `Flashcard: ${c.question.slice(0, 60)}`,
      );
      toast.success("Card moved to Recently Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
    qc.invalidateQueries({ queryKey: ["cards", setId] });
    qc.invalidateQueries({ queryKey: ["sets"] });
  };

  const saving = useRef(false);
  const save = async (q: string, a: string, topic: string, kind: "qa" | "cloze") => {
    if (!user || saving.current) return;
    saving.current = true;
    try {
      await saveInner(q, a, topic, kind);
    } finally {
      saving.current = false;
    }
  };
  const saveInner = async (q: string, a: string, topic: string, kind: "qa" | "cloze") => {
    if (!user) return;
    if (editing === "new") {
      const { error } = await supabase.from("flashcards").insert({
        set_id: setId,
        user_id: user.id,
        question: q,
        answer: a,
        topic,
        card_type: kind,
        is_custom: true,
        position: cards.length,
      });
      if (error) return void toast.error("Couldn't add card");
      toast.success("Card added");
    } else if (editing) {
      const { error } = await supabase
        .from("flashcards")
        .update({ question: q, answer: a, topic, card_type: kind })
        .eq("id", editing.id);
      if (error) return void toast.error("Couldn't save card");
    }
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["cards", setId] });
    qc.invalidateQueries({ queryKey: ["sets"] });
  };

  const regenerate = async () => {
    if (
      cards.length &&
      !confirm("Replace all cards (including your progress) with newly generated ones?")
    )
      return;
    streamController.current?.abort();
    const controller = new AbortController();
    streamController.current = controller;
    setBusy(true);
    try {
      const prompt = await prepareRegen({ data: { setId } });
      setStreamedJson("");
      const cards = await streamAiJson({ system: prompt.system, messages: prompt.messages, signal: controller.signal, onDelta: (chunk) => setStreamedJson((old) => old + chunk), validate: (value) => {
        if (!value || typeof value !== "object" || !Array.isArray((value as { cards?: unknown }).cards)) throw new Error("The generated flashcards were not valid.");
        const candidates = (value as { cards: unknown[] }).cards.filter((card): card is { q: string; a: string; t?: string; kind?: string } => !!card && typeof card === "object" && typeof (card as { q?: unknown }).q === "string" && typeof (card as { a?: unknown }).a === "string" && !!(card as { q: string }).q.trim() && !!(card as { a: string }).a.trim()).map((card) => ({ q: card.q.trim(), a: card.a.trim(), t: typeof card.t === "string" ? card.t.trim() : "", kind: card.kind === "cloze" && /\{\{c1::.+?\}\}/.test(card.q) ? "cloze" as const : "qa" as const }));
        const seen = new Set<string>();
        const valid = candidates.filter((item) => { const key = item.q.toLowerCase().replace(/\{\{c\d+::(.*?)\}\}/g, "$1").replace(/[^a-z0-9]+/g, ""); if (!key || seen.has(key)) return false; seen.add(key); return true; }).slice(0, 20);
        if (!valid.length) throw new Error("No unique flashcards could be generated from the supplied study material.");
        const clozeCount = valid.filter((item) => item.kind === "cloze").length;
        if (valid.length >= 4 && clozeCount === 0) throw new Error("The generated deck contained no valid cloze deletions. Your existing cards were not changed.");
        return valid;
      }});
      await saveRegen({ data: { setId, cards } });
      await qc.invalidateQueries({ queryKey: ["cards", setId] });
      setOrder(null);
      setI(0);
      toast.success("New flashcards generated");
    } catch (e) {
      toast.error(e instanceof DOMException && e.name === "AbortError" ? "Flashcard generation cancelled. Existing cards are unchanged." : e instanceof Error ? e.message : "Failed");
    }
    streamController.current = null;
    setBusy(false);
  };

  const sessionDone = i >= deckIds.length;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-5">
        <Stat label="Due today" value={String(stats.due)} tone="text-cool2" />
        <Stat label="Learning" value={String(stats.learning)} tone="text-violet" />
        <Stat label="Mastered" value={String(stats.mastered)} tone="text-mint" />
        <div className="hidden sm:block">
          <Stat label="Reviewed" value={`${stats.reviewed}/${stats.total}`} />
        </div>
        <div className="hidden sm:block">
          <Stat label="Total" value={String(stats.total)} tone="text-foreground" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex gap-1 p-1 rounded-lg bg-ink2">
          {(["due", "all"] as const).map((m) => (
            <button
              key={m}
              onClick={() => startDeck(m)}
              className={cn(
                "px-3 py-1.5 text-sm font-semibold rounded-md border",
                mode === m ? "bg-cool/20 border-cool/30" : "text-soft border-transparent",
              )}
            >
              {m === "due" ? `Due · weakest first (${stats.due})` : `All (${stats.total})`}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => startDeck(mode, true)}
            className={btnGhost + " !px-3"}
            aria-label="Shuffle"
          >
            <Shuffle className="size-4" /> Shuffle
          </button>
          <button onClick={() => setEditing("new")} className={btnGhost + " !px-3"}>
            <Plus className="size-4" /> Card
          </button>
        </div>
      </div>

      {!cards.length ? (
        <div className="rounded-2xl dpanel p-10 text-center">
          <h2 className="font-display text-2xl uppercase">No flashcards yet</h2>
          {busy && streamedJson && <pre className="mt-4 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-accent p-3 text-xs text-soft">{streamedJson}</pre>}
          {busy && <button type="button" onClick={() => streamController.current?.abort()} className="mt-2 text-xs text-soft underline">Cancel generation</button>}
          <button onClick={regenerate} disabled={busy} className={btnPrimary + " mt-5"}>
            {busy && <Loader2 className="size-4 animate-spin" />} Generate flashcards
          </button>
        </div>
      ) : !card || sessionDone ? (
        <div className="rounded-2xl dpanel p-10 text-center">
          <h2 className="font-display text-3xl uppercase">
            {mode === "due" ? "All caught up" : "Deck complete"}
          </h2>
          <p className="text-soft text-sm mt-2">
            {mode === "due"
              ? "No more cards due right now. Come back later or study the full deck."
              : "You've gone through every card."}
          </p>
          <button onClick={() => startDeck("all", true)} className={btnPrimary + " mt-5"}>
            Study all cards
          </button>
        </div>
      ) : (
        <>
          {card.card_type === "cloze" ? (
            <section className="rounded-2xl bg-ink2 border border-line/70 p-6 md:p-8 min-h-72 md:min-h-80 flex flex-col" aria-label="Cloze deletion exercise">
              <div className="flex justify-between gap-2">
                <p className="eyebrow text-cool2">Cloze deletion · fill in the blank</p>
                <StatusTag card={card} />
              </div>
              <p className="font-display text-2xl md:text-3xl leading-tight text-center my-auto">
                {card.question.replace(/\{\{c1::(.+?)\}\}/g, "________")}
              </p>
              <div className="max-w-xl w-full mx-auto space-y-3">
                <label className="block text-sm font-medium" htmlFor="cloze-response">Your answer</label>
                <input
                  id="cloze-response"
                  value={clozeResponse}
                  onChange={(event) => { setClozeResponse(event.target.value); setClozeChecked(false); }}
                  onKeyDown={(event) => { if (event.key === "Enter" && clozeResponse.trim()) setClozeChecked(true); }}
                  placeholder="Type the missing word or phrase…"
                  className="w-full rounded-xl border border-line bg-background px-4 py-3 text-base text-foreground outline-none focus:ring-2 focus:ring-cool2"
                  autoComplete="off"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setClozeChecked(true)} disabled={!clozeResponse.trim()} className={btnPrimary + " disabled:opacity-40"}>Check answer</button>
                  <button type="button" onClick={() => setClozeRevealed((value) => !value)} className={btnGhost}>{clozeRevealed ? "Hide answer" : "Reveal answer"}</button>
                </div>
                {clozeChecked && (
                  <p role="status" className={cn("text-sm font-semibold", clozeIsCorrect ? "text-mint" : "text-amber-300")}>
                    {clozeIsCorrect ? "Correct — nice work!" : "Not quite. Try again, or reveal the answer."}
                  </p>
                )}
                {clozeRevealed && (
                  <div className="rounded-xl border border-line bg-accent p-4 space-y-1">
                    <p className="eyebrow text-mint">Missing phrase: {clozeTarget}</p>
                    <p className="text-sm leading-relaxed">{card.answer}</p>
                  </div>
                )}
                <p className="text-xs text-soft text-center">Card {idx + 1} of {deckIds.length} · fill in the missing phrase before rating yourself</p>
              </div>
            </section>
          ) : (
            <button
              onClick={() => setFlipped((f) => !f)}
              className="flip-scene block w-full h-72 md:h-80"
              aria-label="Flip card"
            >
              <div className={cn("flip-card relative w-full h-full", flipped && "is-flipped")}>
                <div className="flip-face rounded-2xl bg-ink2 border border-line/70 p-6 md:p-8 flex flex-col">
                  <div className="flex justify-between gap-2">
                    <p className="eyebrow text-cool2 truncate">{card.topic || "Question"}</p>
                    <StatusTag card={card} />
                  </div>
                  <p className="font-display text-2xl md:text-3xl uppercase leading-tight m-auto text-center">{card.question}</p>
                  <p className="text-xs text-soft text-center">Tap to reveal · card {idx + 1} of {deckIds.length}</p>
                </div>
                <div className="flip-face flip-back rounded-2xl dpanel p-6 md:p-8 flex flex-col">
                  <p className="eyebrow text-mint">Answer</p>
                  <p className="text-lg md:text-xl leading-relaxed m-auto text-center">{card.answer}</p>
                  <p className="text-xs text-soft text-center">Rate honestly: uncertain or guessed? Choose Hard / unsure.</p>
                </div>
              </div>
            </button>
          )}
          <div className="grid grid-cols-4 gap-2 mt-4">
            <button
              onClick={() => rate("again")}
              className="font-semibold text-xs sm:text-sm py-2 sm:py-2.5 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
            >
              Again<span className="block text-[10px] text-soft font-normal">~10 min</span>
            </button>
            <button
              onClick={() => rate("hard")}
              className="font-semibold text-xs sm:text-sm py-2 sm:py-2.5 rounded-lg border border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors"
            >
              Hard / unsure
              <span className="block text-[10px] text-soft font-normal">
                {card.interval_days > 1 ? `${Math.round(card.interval_days * 1.2)}d` : "1d"}
              </span>
            </button>
            <button
              onClick={() => rate("good")}
              className="font-semibold text-xs sm:text-sm py-2 sm:py-2.5 rounded-lg border border-violet/50 bg-violet/10 text-violet hover:bg-violet/20 transition-colors"
            >
              Good
              <span className="block text-[10px] text-soft font-normal">
                {card.reps === 0 ? "1d" : card.reps === 1 ? "6d" : `${Math.round(card.interval_days * 2.5)}d`}
              </span>
            </button>
            <button
              onClick={() => rate("easy")}
              className="font-semibold text-xs sm:text-sm py-2 sm:py-2.5 rounded-lg border border-mint/50 bg-mint/10 text-mint hover:bg-mint/20 transition-colors"
            >
              Easy
              <span className="block text-[10px] text-soft font-normal">
                {card.reps === 0 ? "4d" : card.reps === 1 ? "7d" : `${Math.round(card.interval_days * 3.2)}d`}
              </span>
            </button>
          </div>
          <div className="flex items-center justify-between mt-4">
            <button onClick={() => go(-1)} className={btnGhost + " !px-3"} aria-label="Previous">
              <ArrowLeft className="size-4" />
            </button>
            <div className="flex gap-1">
              <button
                onClick={() => setEditing(card)}
                className="p-2 text-soft hover:text-foreground"
                aria-label="Edit card"
              >
                <Pencil className="size-4" />
              </button>
              <button
                onClick={() => del(card)}
                className="p-2 text-soft hover:text-destructive"
                aria-label="Delete card"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <button onClick={() => go(1)} className={btnGhost + " !px-3"} aria-label="Next">
              <ArrowRight className="size-4" />
            </button>
          </div>
        </>
      )}
      {cards.length > 0 && (
        <div className="flex justify-center mt-8">
          {busy && streamedJson && <pre className="mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-accent p-3 text-xs text-soft">{streamedJson}</pre>}
          {busy && <button type="button" onClick={() => streamController.current?.abort()} className="mb-2 text-xs text-soft underline">Cancel generation</button>}
          <button
            onClick={regenerate}
            disabled={busy}
            className="text-xs text-soft hover:text-foreground inline-flex items-center gap-1"
          >
            {busy && <Loader2 className="size-3 animate-spin" />}Regenerate all cards
          </button>
        </div>
      )}
      <CardDialog editing={editing} onClose={() => setEditing(null)} onSave={save} />
    </div>
  );
}

function CardDialog({
  editing,
  onClose,
  onSave,
}: {
  editing: Flashcard | "new" | null;
  onClose: () => void;
  onSave: (q: string, a: string, t: string, kind: "qa" | "cloze") => void;
}) {
  const init = editing && editing !== "new" ? editing : null;
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{init ? "Edit card" : "New card"}</DialogTitle>
        </DialogHeader>
        <form
          key={init?.id ?? "new"}
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const q = String(f.get("q") ?? "").trim();
            const a = String(f.get("a") ?? "").trim();
            if (!q || !a) return;
            const kind = String(f.get("kind") ?? "qa") === "cloze" ? "cloze" : "qa";
            if (kind === "cloze" && !/\{\{c1::.+?\}\}/.test(q)) { toast.error("Add a hidden phrase using {{c1::answer}} in the cloze prompt."); return; }
            onSave(q, a, String(f.get("t") ?? "").trim(), kind);
          }}
        >
          <label className="block text-xs text-soft">Card format<select name="kind" defaultValue={init?.card_type ?? "qa"} className={inputCls + " w-full mt-1"}><option value="qa">Question and answer</option><option value="cloze">Cloze deletion</option></select></label>
          <textarea
            name="q"
            required
            rows={2}
            defaultValue={init?.question}
            placeholder="Question or cloze, e.g. {{c1::mitochondria}} produce ATP"
            className={inputCls + " w-full"}
          />
          <textarea
            name="a"
            required
            rows={3}
            defaultValue={init?.answer}
            placeholder="Answer"
            className={inputCls + " w-full"}
          />
          <input
            name="t"
            defaultValue={init?.topic}
            placeholder="Topic (optional)"
            className={inputCls + " w-full"}
          />
          <DialogFooter>
            <button className={btnPrimary}>Save</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusTag({ card }: { card: Flashcard }) {
  const s = card.status;
  const interval = card.interval_days > 0 ? `${card.interval_days}d interval` : null;
  const reps = card.reps > 0 ? `${card.reps} revs` : null;
  const srsBadge = interval ? ` (${interval})` : reps ? ` (${reps})` : "";

  if (s === "known") return <span className="eyebrow text-mint">Mastered{srsBadge}</span>;
  if (s === "learning" || s === "review")
    return <span className="eyebrow text-violet">Learning{srsBadge}</span>;
  return <span className="eyebrow text-soft">New (Due)</span>;
}
