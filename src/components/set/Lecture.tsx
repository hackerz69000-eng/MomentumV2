import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  ArrowLeft,
  Brain,
  ClipboardCheck,
  Layers,
  ListChecks,
  Loader2,
  Mic,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Square,
  Trash2,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { lectureCards, lectureGuide, lectureNotes } from "@/lib/lecture.functions";
import { logActivity } from "@/lib/log-activity";
import { micErrorMessage, startRecorder, transcribeSegment, type Recorder } from "@/lib/recorder";
import type { StudySet } from "@/lib/queries";
import type { Attempt, TopicRow } from "@/lib/stats";
import { cn } from "@/lib/utils";
import { trashRow } from "@/lib/trash";
import { SaveStatus } from "@/components/SaveStatus";
import { btnGhost, btnPrimary, ErrorBox, inputCls } from "./ui";
import { QuizRunner } from "./QuizRunner";
import { ActiveRecall } from "./ActiveRecall";

type LectureRow = Tables<"lectures">;
const recKey = (setId: string) => `momentum:rec:${setId}`;
type RecDraft = { id: string; elapsed: number; title: string };
const readDraft = (setId: string): RecDraft | null => {
  try {
    return JSON.parse(localStorage.getItem(recKey(setId)) ?? "null");
  } catch {
    return null;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (s: number) =>
  `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function Lecture({
  set,
  attempts,
  topics,
}: {
  set: StudySet;
  attempts: Attempt[];
  topics: TopicRow[];
}) {
  const listQ = useQuery({
    queryKey: ["lectures", set.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lectures")
        .select("*")
        .eq("set_id", set.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LectureRow[];
    },
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const open = listQ.data?.find((l) => l.id === openId);
  const [draft, setDraft] = useState<RecDraft | null>(null);
  useEffect(() => {
    if (!recording) setDraft(readDraft(set.id));
  }, [recording, set.id]);
  const recover = async () => {
    if (!draft) return;
    const { error } = await supabase
      .from("lectures")
      .update({ duration_seconds: draft.elapsed, updated_at: new Date().toISOString() })
      .eq("id", draft.id);
    if (error) {
      toast.error("Couldn't recover the lecture — check your connection and try again.");
      return;
    }
    localStorage.removeItem(recKey(set.id));
    setDraft(null);
    const res = await listQ.refetch();
    const row = res.data?.find((l) => l.id === draft.id);
    setOpenId(draft.id);
    if (!row) toast.error("Nothing from that recording was saved before the interruption.");
    else if (row.transcript.trim())
      toast.success(
        "Recovered the transcript saved before the interruption. If parts are missing, use “Retry transcription”.",
      );
    else if (row.audio_paths.length)
      toast.success(
        `Recovered ${row.audio_paths.length} saved audio part(s), but no transcript yet — press “Retry transcription”.`,
      );
    else toast.error("The lecture was recovered, but no audio or transcript had been saved yet.");
  };

  if (recording)
    return (
      <RecordPanel
        set={set}
        onDone={(id) => {
          setRecording(false);
          setOpenId(id);
        }}
        onCancel={() => setRecording(false)}
      />
    );
  if (open)
    return (
      <LectureDetail
        key={open.id}
        set={set}
        lecture={open}
        attempts={attempts}
        topics={topics}
        onBack={() => setOpenId(null)}
      />
    );

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="rounded-2xl dpanel p-6 md:p-8">
        <p className="eyebrow text-cool2">Lecture Mode</p>
        <h2 className="font-display text-3xl uppercase mt-1">Record your class</h2>
        <p className="text-sm text-soft mt-1 max-w-lg">
          Momentum transcribes the lecture, organizes it into study notes and can turn it into
          flashcards, quizzes, Active Recall, practice exams and a study guide.
        </p>
        <button onClick={() => setRecording(true)} className={btnPrimary + " mt-5"}>
          <Mic className="size-4" /> Record Lecture
        </button>
      </div>
      {draft && (
        <div className="rounded-2xl border border-cool/40 bg-cool/10 p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>
            <b>A recording was interrupted</b> ("{draft.title}", {fmt(draft.elapsed)}). Every part
            transcribed before it stopped was saved.
          </span>
          <span className="flex gap-2">
            <button onClick={recover} className={btnPrimary}>
              Open recovered lecture
            </button>
            <button
              onClick={() => {
                localStorage.removeItem(recKey(set.id));
                setDraft(null);
              }}
              className={btnGhost}
            >
              Dismiss
            </button>
          </span>
        </div>
      )}
      {listQ.isLoading && <Loader2 className="size-5 animate-spin text-cool2 mx-auto" />}
      {listQ.data?.length ? (
        <div className="rounded-2xl bg-panel border border-line/70 divide-y divide-line/60">
          {listQ.data.map((l) => (
            <button
              key={l.id}
              onClick={() => setOpenId(l.id)}
              className="w-full text-left p-4 hover:bg-foreground/5 flex justify-between gap-4"
            >
              <span className="min-w-0">
                <span className="font-semibold block truncate">{l.title}</span>
                <span className="text-xs text-soft">
                  {new Date(l.created_at).toLocaleString()} · {fmt(l.duration_seconds)} ·{" "}
                  {l.transcript
                    ? `${l.transcript.split(/\s+/).length.toLocaleString()} words`
                    : "no transcript yet"}
                </span>
              </span>
              <span className="flex gap-2 shrink-0 items-start">
                {l.notes && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-mint/40 text-mint">
                    Notes
                  </span>
                )}
                {l.in_material && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-cool/40 text-cool2">
                    In set material
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      ) : (
        !listQ.isLoading && <p className="text-sm text-soft text-center">No lectures yet.</p>
      )}
    </div>
  );
}

function RecordPanel({
  set,
  onDone,
  onCancel,
}: {
  set: StudySet;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const notesFn = useServerFn(lectureNotes);
  const [title, setTitle] = useState(`Lecture — ${new Date().toLocaleDateString()}`);
  const [state, setState] = useState<"idle" | "starting" | "rec" | "paused" | "finishing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [segInfo, setSegInfo] = useState({ done: 0, total: 0, failed: 0 });
  const [segNote, setSegNote] = useState<string | null>(null);
  const rec = useRef<Recorder | null>(null);
  const lectureId = useRef<string | null>(null);
  const texts = useRef<string[]>([]);
  const paths = useRef<string[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (state !== "rec") return;
    const t = setInterval(() => {
      setElapsed((e) => e + 1);
      setLevel(rec.current?.level() ?? 0);
    }, 1000);
    const l = setInterval(() => setLevel(rec.current?.level() ?? 0), 120);
    return () => {
      clearInterval(t);
      clearInterval(l);
    };
  }, [state]);
  useEffect(
    () => () => {
      void rec.current?.stop().catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if ((state === "rec" || state === "paused") && lectureId.current && elapsed % 5 === 0)
      localStorage.setItem(
        recKey(set.id),
        JSON.stringify({ id: lectureId.current, elapsed, title }),
      );
  }, [elapsed, state, set.id, title]);
  useEffect(() => {
    if (state !== "rec" && state !== "paused") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  const handleSegment = (wav: File, i: number) => {
    setSegInfo((s) => ({ ...s, total: s.total + 1 }));
    queue.current = queue.current.then(async () => {
      const id = lectureId.current!;
      const path = `${user!.id}/${set.id}/lectures/${id}/part-${String(i + 1).padStart(3, "0")}.wav`;
      const up = await supabase.storage
        .from("study-files")
        .upload(path, wav, { contentType: "audio/wav", upsert: true });
      if (!up.error) paths.current[i] = path;
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          if (attempt) {
            setSegNote(`Connection problem — retrying part ${i + 1} (${attempt}/2)…`);
            await sleep(attempt * 4000);
          }
          texts.current[i] = await transcribeSegment(wav, (d) =>
            setLive((t) => (t + d).slice(-1200)),
          );
          ok = true;
        } catch {
          /* retry */
        }
      }
      setSegNote(null);
      if (ok) setSegInfo((s) => ({ ...s, done: s.done + 1 }));
      else {
        texts.current[i] = "";
        setSegInfo((s) => ({ ...s, failed: s.failed + 1 }));
        toast.error(
          `Part ${i + 1} couldn't be transcribed${up.error ? "" : ", but its audio is saved — use “Re-transcribe audio” later"}. Recording continues.`,
        );
      }
      await supabase
        .from("lectures")
        .update({
          transcript: texts.current.filter(Boolean).join("\n\n"),
          audio_paths: paths.current.filter(Boolean),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    });
  };

  const start = async () => {
    if (!user) return;
    setError(null);
    setState("starting");
    try {
      const { data, error: insErr } = await supabase
        .from("lectures")
        .insert({ set_id: set.id, user_id: user.id, title: title.trim() || "Lecture" })
        .select("id")
        .single();
      if (insErr || !data) throw new Error("Couldn't create the lecture");
      lectureId.current = data.id;
      rec.current = await startRecorder(handleSegment);
      setState("rec");
    } catch (e) {
      if (lectureId.current) await supabase.from("lectures").delete().eq("id", lectureId.current);
      lectureId.current = null;
      setError(micErrorMessage(e));
      setState("idle");
    }
  };

  const pause = async () => {
    await rec.current?.pause();
    setState("paused");
  };
  const resume = async () => {
    await rec.current?.resume();
    setState("rec");
  };
  const finish = async () => {
    setState("finishing");
    await rec.current?.stop();
    rec.current = null;
    const timedOut = await Promise.race([
      queue.current.then(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(true), 90_000)),
    ]);
    if (timedOut)
      toast.error(
        "Some audio is still uploading slowly. Everything finished so far is saved — you can retry transcription from the lecture.",
      );
    const id = lectureId.current!;
    const transcript = texts.current.filter(Boolean).join("\n\n");
    const { error: saveErr } = await supabase
      .from("lectures")
      .update({
        transcript,
        duration_seconds: elapsed,
        audio_paths: paths.current.filter(Boolean),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (saveErr)
      toast.error(
        "Couldn't save the final transcript. Your recording draft is kept — reopen Lecture Mode to recover it.",
      );
    if (transcript.trim().length > 40) {
      try {
        await notesFn({ data: { lectureId: id } });
      } catch {
        toast.error(
          "Your transcript was saved, but organizing notes failed. Open the lecture and press “Organize notes” to try again.",
        );
      }
    } else
      toast.error("No speech was captured. You can retry transcription or paste the transcript.");
    localStorage.removeItem(recKey(set.id));
    void logActivity("lecture", set.id, 1, qc, {
      duration_seconds: elapsed,
      meta: { lecture: id },
    });
    qc.invalidateQueries({ queryKey: ["lectures", set.id] });
    onDone(id);
  };

  if (state === "idle" || state === "starting")
    return (
      <div className="max-w-xl mx-auto rounded-2xl bg-panel border border-line/70 p-6 md:p-8 space-y-4">
        <button
          onClick={onCancel}
          className="text-xs text-soft hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="size-3" /> Lectures
        </button>
        <h2 className="font-display text-3xl uppercase">Record Lecture</h2>
        <label className="block text-sm">
          <span className="eyebrow text-soft">Lecture title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputCls + " w-full mt-1.5"}
            maxLength={120}
          />
        </label>
        <p className="text-xs text-soft">
          Your browser will ask for microphone permission. Keep this tab open while recording.
        </p>
        {error && <ErrorBox msg={error} />}
        <button onClick={start} disabled={state === "starting"} className={btnPrimary}>
          {state === "starting" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Mic className="size-4" />
          )}{" "}
          Start recording
        </button>
      </div>
    );

  return (
    <div className="max-w-xl mx-auto rounded-2xl dpanel p-6 md:p-8 space-y-5 text-center">
      <div className="flex items-center justify-center gap-2">
        <span
          className={cn(
            "size-3 rounded-full",
            state === "rec" ? "bg-destructive animate-pulse" : "bg-soft",
          )}
        />
        <span className="eyebrow">
          {state === "rec" ? "Recording" : state === "paused" ? "Paused" : "Processing"}
        </span>
      </div>
      <p className="font-display text-6xl tabular-nums">{fmt(elapsed)}</p>
      <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden max-w-xs mx-auto">
        <div
          className="h-full bg-mint transition-[width] duration-100"
          style={{ width: `${Math.min(100, level * 160)}%` }}
        />
      </div>
      <p className="text-xs text-soft">
        {title} · transcribed {segInfo.done}/{segInfo.total} parts
        {segInfo.failed ? ` · ${segInfo.failed} failed` : ""} (every ~4 min)
      </p>
      {segNote && <p className="text-xs text-cool2">{segNote}</p>}
      {live && (
        <p className="text-xs text-left text-soft rounded-lg bg-foreground/5 p-3 max-h-24 overflow-hidden">
          …{live.slice(-400)}
        </p>
      )}
      {state === "finishing" ? (
        <p className="text-sm inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Transcribing the last part and organizing your
          notes…
        </p>
      ) : (
        <div className="flex justify-center gap-2">
          {state === "rec" ? (
            <button onClick={pause} className={btnGhost}>
              <Pause className="size-4" /> Pause
            </button>
          ) : (
            <button onClick={resume} className={btnGhost}>
              <Play className="size-4" /> Resume
            </button>
          )}
          <button onClick={finish} className={btnPrimary}>
            <Square className="size-4" /> Stop & finish
          </button>
        </div>
      )}
    </div>
  );
}

type View = null | "quiz" | "adaptive" | "recall" | "exam";

function LectureDetail({
  set,
  lecture,
  attempts,
  topics,
  onBack,
}: {
  set: StudySet;
  lecture: LectureRow;
  attempts: Attempt[];
  topics: TopicRow[];
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const notesFn = useServerFn(lectureNotes);
  const cardsFn = useServerFn(lectureCards);
  const guideFn = useServerFn(lectureGuide);
  const [transcript, setTranscript] = useState(lecture.transcript);
  const [title, setTitle] = useState(lecture.title);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<View>(null);
  const [section, setSection] = useState<"notes" | "transcript" | "guide">(
    lecture.notes ? "notes" : "transcript",
  );
  const [audio, setAudio] = useState<string[]>([]);
  const dirty = transcript !== lecture.transcript || title !== lecture.title;
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    if (!dirty) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      const { error } = await supabase
        .from("lectures")
        .update({
          transcript,
          title: title.trim() || "Lecture",
          updated_at: new Date().toISOString(),
        })
        .eq("id", lecture.id);
      setSaveState(error ? "error" : "saved");
      if (!error)
        qc.setQueryData<LectureRow[]>(["lectures", set.id], (old) =>
          old?.map((l) =>
            l.id === lecture.id ? { ...l, transcript, title: title.trim() || "Lecture" } : l,
          ),
        );
    }, 1200);
    return () => clearTimeout(t);
  }, [transcript, title, lecture.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => qc.invalidateQueries({ queryKey: ["lectures", set.id] });

  useEffect(() => {
    if (!lecture.audio_paths.length) return;
    void supabase.storage
      .from("study-files")
      .createSignedUrls(lecture.audio_paths, 3600)
      .then(({ data }) =>
        setAudio((data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[]),
      );
  }, [lecture.audio_paths]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      toast.error(
        key === "save" || key === "material"
          ? m || "Couldn't save. Your text is still here — try again."
          : `Your transcript is safe, but this step failed: ${m || "please try again"}`,
      );
    }
    setBusy(null);
    refresh();
  };
  const save = () =>
    run(
      "save",
      async () => {
        const { error } = await supabase
          .from("lectures")
          .update({
            transcript,
            title: title.trim() || "Lecture",
            updated_at: new Date().toISOString(),
          })
          .eq("id", lecture.id);
        if (error) throw error;
      },
      "Transcript saved",
    );
  const retryTranscribe = () =>
    run(
      "retry",
      async () => {
        const parts: string[] = [];
        let failed = 0;
        for (const p of lecture.audio_paths) {
          try {
            const { data, error } = await supabase.storage.from("study-files").download(p);
            if (error || !data) throw new Error("download");
            parts.push(
              await transcribeSegment(
                new File([data], "part.wav", { type: "audio/wav" }),
                () => {},
              ),
            );
          } catch {
            failed++;
            parts.push("");
          }
        }
        const t = parts.filter(Boolean).join("\n\n");
        if (!t.trim()) throw new Error("No audio part could be transcribed. Please try again.");
        const { error } = await supabase
          .from("lectures")
          .update({ transcript: t })
          .eq("id", lecture.id);
        if (error) throw new Error("Transcribed, but couldn't save the transcript — try again.");
        setTranscript(t);
        if (failed)
          toast.error(
            `${failed} of ${lecture.audio_paths.length} audio parts couldn't be transcribed; the rest was saved.`,
          );
      },
      "Lecture transcribed again",
    );
  const toggleMaterial = () =>
    run(
      "material",
      async () => {
        const header = `=== Lecture: ${lecture.title} ===`;
        const { data: s } = await supabase
          .from("study_sets")
          .select("material_text")
          .eq("id", set.id)
          .single();
        let text = s?.material_text ?? "";
        const re = new RegExp(
          `\\n*${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?(?=\\n=== |$)`,
        );
        text = text.replace(re, "");
        if (!lecture.in_material)
          text = `${text.trim()}\n\n${header}\n${lecture.transcript.trim()}`;
        const { error: e1 } = await supabase
          .from("study_sets")
          .update({ material_text: text.trim(), updated_at: new Date().toISOString() })
          .eq("id", set.id);
        if (e1) throw new Error("Couldn't update the set material — try again.");
        const { error: e2 } = await supabase
          .from("lectures")
          .update({ in_material: !lecture.in_material })
          .eq("id", lecture.id);
        if (e2) throw new Error("Material updated, but the lecture flag didn't save — try again.");
        qc.invalidateQueries({ queryKey: ["set", set.id] });
      },
      lecture.in_material
        ? "Removed from set material"
        : "Added to set material — quizzes on the whole set now include this lecture",
    );
  const remove = async () => {
    if (!confirm("Move this lecture to Recently Deleted? You can restore it for 30 days.")) return;
    try {
      await trashRow("lecture", "lectures", lecture, `Lecture: ${lecture.title}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
      return;
    }
    refresh();
    onBack();
  };

  if (view)
    return (
      <div className="space-y-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between rounded-xl bg-panel border border-line/70 px-4 py-3 text-sm">
          <span>
            <span className="eyebrow text-cool2">From lecture</span>{" "}
            <span className="font-semibold ml-2">{lecture.title}</span>
          </span>
          <button onClick={() => setView(null)} className={cn(btnGhost, "py-1.5")}>
            <ArrowLeft className="size-4" /> Back to lecture
          </button>
        </div>
        {view === "quiz" && (
          <QuizRunner
            key="lq"
            set={set}
            kind="quiz"
            attempts={attempts}
            topics={topics}
            lectureId={lecture.id}
          />
        )}
        {view === "adaptive" && (
          <QuizRunner
            key="la"
            set={set}
            kind="quiz"
            attempts={attempts}
            topics={topics}
            lectureId={lecture.id}
            preset={{ adaptive: true }}
          />
        )}
        {view === "exam" && (
          <QuizRunner key="le" set={set} kind="exam" attempts={attempts} lectureId={lecture.id} />
        )}
        {view === "recall" && (
          <ActiveRecall setId={set.id} topics={topics} lectureId={lecture.id} />
        )}
      </div>
    );

  const hasText = lecture.transcript.trim().length > 40;
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="text-xs text-soft hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="size-3" /> All lectures
        </button>
        <button
          onClick={remove}
          className="text-xs text-soft hover:text-destructive inline-flex items-center gap-1"
        >
          <Trash2 className="size-3" /> Delete lecture
        </button>
      </div>
      <div className="rounded-2xl dpanel p-6 space-y-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="bg-transparent font-display text-3xl uppercase w-full outline-none"
        />
        <p className="text-xs text-soft">
          {new Date(lecture.created_at).toLocaleString()} · {fmt(lecture.duration_seconds)} recorded
          · {lecture.transcript.split(/\s+/).filter(Boolean).length.toLocaleString()} words
        </p>
        <div>
          <p className="eyebrow text-soft mb-2">Generate study materials from this lecture</p>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={!hasText || !!busy}
              onClick={() =>
                run(
                  "cards",
                  () =>
                    cardsFn({ data: { lectureId: lecture.id } }).then((r) => {
                      qc.invalidateQueries({ queryKey: ["cards", set.id] });
                      return r;
                    }),
                  "Lecture flashcards added to your deck",
                )
              }
              className={btnGhost}
            >
              {busy === "cards" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Layers className="size-4" />
              )}{" "}
              Flashcards
            </button>
            <button disabled={!hasText} onClick={() => setView("quiz")} className={btnGhost}>
              <Zap className="size-4" /> Quiz
            </button>
            <button disabled={!hasText} onClick={() => setView("adaptive")} className={btnGhost}>
              <Brain className="size-4" /> Adaptive Quiz
            </button>
            <button disabled={!hasText} onClick={() => setView("recall")} className={btnGhost}>
              <ListChecks className="size-4" /> Active Recall
            </button>
            <button disabled={!hasText} onClick={() => setView("exam")} className={btnGhost}>
              <ClipboardCheck className="size-4" /> Practice Exam
            </button>
            <button
              disabled={!hasText || !!busy}
              onClick={() =>
                run("guide", async () => {
                  await guideFn({ data: { lectureId: lecture.id } });
                  setSection("guide");
                })
              }
              className={btnGhost}
            >
              {busy === "guide" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ScrollText className="size-4" />
              )}{" "}
              Study Guide
            </button>
          </div>
          <p className="text-xs text-soft mt-2">
            These use only this lecture. Results still count toward this set's progress.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-cool2/20">
          <button disabled={!hasText || !!busy} onClick={toggleMaterial} className={btnGhost}>
            {busy === "material" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}{" "}
            {lecture.in_material ? "Remove from set material" : "Combine with set material"}
          </button>
          <span className="text-xs text-soft">
            {lecture.in_material
              ? "This lecture is part of the set's material, so whole-set quizzes and the tutor use it too."
              : "Kept separate. Combine it to include it in whole-set quizzes, notes and the tutor."}
          </span>
        </div>
      </div>

      <div className="flex gap-1">
        {(["notes", "transcript", "guide"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSection(k)}
            className={cn(
              "px-4 py-2 text-sm font-semibold rounded-lg border",
              section === k ? "bg-cool/20 border-cool/30" : "border-transparent text-soft",
            )}
          >
            {k === "notes" ? "Lecture notes" : k === "transcript" ? "Transcript" : "Study guide"}
          </button>
        ))}
      </div>

      {section === "transcript" && (
        <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3">
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={18}
            placeholder="No transcript yet. You can retry transcription or paste it here."
            className={inputCls + " w-full font-mono text-xs leading-relaxed"}
          />
          <div className="flex flex-wrap gap-2">
            <SaveStatus state={saveState} />
            {saveState === "error" && (
              <button onClick={save} className={btnPrimary}>
                Retry save
              </button>
            )}
            {lecture.audio_paths.length > 0 && (
              <button disabled={!!busy} onClick={retryTranscribe} className={btnGhost}>
                {busy === "retry" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}{" "}
                Re-transcribe audio
              </button>
            )}
          </div>
          {audio.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="eyebrow text-soft">Recording</p>
              {audio.map((u, i) => (
                <audio
                  key={u}
                  controls
                  src={u}
                  className="w-full h-9"
                  aria-label={`Part ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {section === "notes" && (
        <div className="rounded-2xl bg-panel border border-line/70 p-6">
          <div className="flex justify-end mb-2">
            <button
              disabled={!hasText || !!busy}
              onClick={() =>
                run("notes", () => notesFn({ data: { lectureId: lecture.id } }), "Notes updated")
              }
              className={cn(btnGhost, "py-1.5")}
            >
              {busy === "notes" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}{" "}
              {lecture.notes ? "Regenerate notes" : "Organize notes"}
            </button>
          </div>
          {lecture.notes ? (
            <article className="prose prose-invert max-w-none prose-headings:font-display prose-headings:uppercase prose-h2:text-cool2">
              <ReactMarkdown>{lecture.notes}</ReactMarkdown>
            </article>
          ) : (
            <p className="text-sm text-soft">
              {hasText ? "No organized notes yet." : "Add a transcript first."}
            </p>
          )}
        </div>
      )}
      {section === "guide" && (
        <div className="rounded-2xl bg-panel border border-line/70 p-6">
          {lecture.guide ? (
            <article className="prose prose-invert max-w-none prose-headings:font-display prose-headings:uppercase prose-h2:text-cool2">
              <ReactMarkdown>{lecture.guide}</ReactMarkdown>
            </article>
          ) : (
            <p className="text-sm text-soft">
              No lecture study guide yet — use "Study Guide" above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
