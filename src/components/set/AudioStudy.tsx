import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  AudioLines,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  SkipBack,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  askAudioStudy,
  audioStudyQuiz,
  generateAudioSpeech,
  generateAudioStudy,
  type AudioSection,
  type AudioStudyMode,
} from "@/lib/audio-study.functions";
import { gradeRecall, type RecallGrade } from "@/lib/study.functions";
import { recordResults } from "@/lib/mistakes";
import { logActivity } from "@/lib/log-activity";
import type { StudySet } from "@/lib/queries";
import type { TopicRow } from "@/lib/stats";
import type { Tables } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { btnGhost, btnPrimary, ErrorBox, inputCls } from "./ui";

type Session = Tables<"audio_study_sessions">;
type Event = Tables<"audio_study_events">;
type Message = { role: "user" | "assistant"; content: string };

const MODES: { value: AudioStudyMode; title: string; detail: string }[] = [
  { value: "quick", title: "Quick Review", detail: "5–10 min · the most important testable ideas" },
  { value: "full", title: "Full Study Session", detail: "15–30 min · a thorough lesson" },
  { value: "deep", title: "Deep Dive", detail: "Detailed explanations and concept connections" },
  {
    value: "weak",
    title: "Weak Topics",
    detail: "Focus on repeated struggles and surrounding context",
  },
];

const ACTIONS = [
  "Explain this more simply",
  "Explain this in more detail",
  "Give me an example",
  "Compare this with the previous concept",
  "What should I remember for the test?",
] as const;

const GRADE: Record<RecallGrade, { label: string; score: number; tone: string }> = {
  correct: { label: "Correct", score: 4, tone: "text-mint border-mint/40 bg-mint/10" },
  mostly: { label: "Mostly correct", score: 3, tone: "text-mint border-mint/30 bg-mint/5" },
  partial: { label: "Partially correct", score: 2, tone: "text-cool2 border-cool/40 bg-cool/10" },
  incorrect: {
    label: "Incorrect",
    score: 0,
    tone: "text-destructive border-destructive/40 bg-destructive/10",
  },
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const sectionFile = (i: number) => `section-${String(i + 1).padStart(2, "0")}.mp3`;
function missingSections(session: Pick<Session, "sections" | "audio_paths">) {
  const sections = (session.sections as AudioSection[] | null) ?? [];
  return sections
    .map((_, i) => i)
    .filter((i) => !session.audio_paths.some((p) => p.endsWith(sectionFile(i))));
}

type VoiceFn = (opts: {
  data: { sessionId: string; index: number };
}) => Promise<{ paths: string[]; complete: boolean }>;
/** Voices each missing section in its own request (one request can't fit a whole lesson). */
async function voiceLesson(
  voice: VoiceFn,
  session: Session,
  onProgress: (done: number, total: number) => void,
) {
  const total = ((session.sections as AudioSection[] | null) ?? []).length;
  const missing = missingSections(session);
  let paths = session.audio_paths;
  let done = total - missing.length;
  onProgress(done, total);
  for (const index of missing) {
    let result: { paths: string[] } | null = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await voice({ data: { sessionId: session.id, index } });
      } catch (e) {
        if (attempt === 1) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    paths = result!.paths;
    onProgress(++done, total);
  }
  return paths;
}

export function AudioStudy({ set, topics }: { set: StudySet; topics: TopicRow[] }) {
  const qc = useQueryClient();
  const sessionsQ = useQuery({
    queryKey: ["audio-study", set.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audio_study_sessions")
        .select("*")
        .eq("set_id", set.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const [selected, setSelected] = useState<string | null>(null);
  const sessions = sessionsQ.data ?? [];
  const active =
    selected === "new" ? null : (sessions.find((s) => s.id === selected) ?? sessions[0] ?? null);
  if (active)
    return <Player key={active.id} set={set} session={active} onBack={() => setSelected("new")} />;
  return (
    <SessionPicker
      set={set}
      topics={topics}
      sessions={sessions}
      onOpen={setSelected}
      onCreated={(id) => {
        setSelected(id);
        qc.invalidateQueries({ queryKey: ["audio-study", set.id] });
      }}
    />
  );
}

function SessionPicker({
  set,
  topics,
  sessions,
  onOpen,
  onCreated,
}: {
  set: StudySet;
  topics: TopicRow[];
  sessions: Session[];
  onOpen: (id: string) => void;
  onCreated: (id: string) => void;
}) {
  const generate = useServerFn(generateAudioStudy);
  const voice = useServerFn(generateAudioSpeech);
  const [mode, setMode] = useState<AudioStudyMode>("quick");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const weakReady = topics.length > 0;
  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const requestKey = crypto.randomUUID();
      const { session } = await generate({ data: { setId: set.id, mode, requestKey } });
      try {
        await voiceLesson(voice, session as Session, (d, t) =>
          setProgress(`Recording audio ${Math.min(d + 1, t)} of ${t}…`),
        );
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "The script is saved, but audio needs another try.",
        );
      }
      onCreated(session.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the lesson");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <p className="eyebrow text-mint">Audio Study</p>
        <h2 className="font-display text-4xl uppercase mt-1">Learn by listening</h2>
        <p className="text-sm text-soft mt-2 max-w-2xl">
          Momentum teaches your material as a focused lesson. Pause any time to ask a question, get
          another explanation, or test yourself.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {MODES.map((m) => {
          const disabled = m.value === "weak" && !weakReady;
          return (
            <button
              key={m.value}
              disabled={disabled}
              onClick={() => setMode(m.value)}
              className={cn(
                "text-left rounded-xl border p-4 transition-colors disabled:opacity-40",
                mode === m.value
                  ? "border-cool/50 bg-cool/15"
                  : "border-line/70 bg-panel hover:border-cool/30",
              )}
            >
              <span className="font-semibold text-sm block">{m.title}</span>
              <span className="text-xs text-soft mt-1 block">
                {disabled ? "Complete a quiz or recall session first" : m.detail}
              </span>
            </button>
          );
        })}
      </div>
      {error && <ErrorBox msg={error} />}
      <button onClick={start} disabled={busy} className={btnPrimary}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{" "}
        {busy ? (progress ?? "Writing your lesson…") : "Create Audio Lesson"}
      </button>
      {sessions.length > 0 && (
        <section className="border-t border-line/70 pt-5">
          <h3 className="eyebrow text-soft mb-3">Previous sessions</h3>
          <div className="space-y-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpen(s.id)}
                className="w-full rounded-xl bg-panel border border-line/70 p-3 text-left flex items-center justify-between gap-4 hover:border-cool/40"
              >
                <span>
                  <span className="font-semibold text-sm block">{s.title}</span>
                  <span className="text-xs text-soft">
                    {MODES.find((m) => m.value === s.mode)?.title} ·{" "}
                    {new Date(s.created_at).toLocaleString()}
                  </span>
                </span>
                <span className="text-xs text-cool2">
                  {s.completed
                    ? "Completed"
                    : s.position_seconds > 0
                      ? `Resume at ${formatTime(s.position_seconds)}`
                      : "Open"}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Player({
  set,
  session: initial,
  onBack,
}: {
  set: StudySet;
  session: Session;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ask = useServerFn(askAudioStudy);
  const quizFn = useServerFn(audioStudyQuiz);
  const gradeFn = useServerFn(gradeRecall);
  const voice = useServerFn(generateAudioSpeech);
  const [session, setSession] = useState(initial);
  const [urls, setUrls] = useState<string[]>([]);
  const [sectionIndex, setSectionIndex] = useState(initial.section_index);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(initial.position_seconds);
  const [sectionDuration, setSectionDuration] = useState(0);
  const [durations, setDurations] = useState<number[]>([]);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState<"ask" | "voice" | "quiz" | "grade" | null>(null);
  const [voiceProgress, setVoiceProgress] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<{
    question: string;
    topic: string;
    model: string;
    answer: string;
    result?: { grade: RecallGrade; feedback: string; model: string };
    saved?: boolean;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSaved = useRef(initial.position_seconds);
  const sections = (session.sections as AudioSection[] | null) ?? [];
  const current = sections[sectionIndex];

  const eventsQ = useQuery({
    queryKey: ["audio-events", session.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audio_study_events")
        .select("*")
        .eq("session_id", session.id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  useEffect(() => {
    const rows = eventsQ.data ?? [];
    setMessages(
      rows
        .filter((e: Event) => e.kind === "question" || e.kind === "answer")
        .map((e: Event) => ({
          role: e.kind === "question" ? ("user" as const) : ("assistant" as const),
          content: e.content,
        })),
    );
  }, [eventsQ.data]);
  useEffect(() => {
    let live = true;
    void Promise.all(
      session.audio_paths.map((path) =>
        supabase.storage.from("study-files").createSignedUrl(path, 3600),
      ),
    ).then((all) => {
      if (!live) return;
      const nextUrls = all.map((r) => r.data?.signedUrl).filter((u): u is string => Boolean(u));
      setUrls(nextUrls);
      void Promise.all(
        nextUrls.map(
          (url) =>
            new Promise<number>((resolve) => {
              const audio = new Audio(url);
              audio.preload = "metadata";
              audio.onloadedmetadata = () =>
                resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
              audio.onerror = () => resolve(0);
            }),
        ),
      ).then((nextDurations) => {
        if (live) setDurations(nextDurations);
      });
    });
    return () => {
      live = false;
    };
  }, [session.audio_paths]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, urls, sectionIndex]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !urls.length) return;
    const remaining = session.position_seconds;
    if (remaining <= 0) return;
    const seek = () => {
      audio.currentTime = Math.min(
        remaining,
        Number.isFinite(audio.duration) ? audio.duration : remaining,
      );
      setElapsed(remaining);
    };
    audio.addEventListener("loadedmetadata", seek, { once: true });
    return () => audio.removeEventListener("loadedmetadata", seek);
  }, [urls, session.position_seconds]);

  const savePosition = async (complete = false) => {
    const next = audioRef.current?.currentTime ?? elapsed;
    if (!complete && Math.abs(next - lastSaved.current) < 3) return;
    lastSaved.current = next;
    await supabase
      .from("audio_study_sessions")
      .update({
        section_index: sectionIndex,
        position_seconds: next,
        duration_seconds: sectionDuration,
        completed: complete,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    qc.invalidateQueries({ queryKey: ["audio-study", set.id] });
  };
  useEffect(
    () => () => {
      void savePosition(false);
    },
    [],
  );

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
      void savePosition();
    }
  };
  const skip = (delta: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + delta));
  };
  const seekLesson = (target: number) => {
    let remaining = Math.max(0, target);
    let nextIndex = 0;
    for (; nextIndex < durations.length - 1 && remaining > (durations[nextIndex] ?? 0); nextIndex++)
      remaining -= durations[nextIndex] ?? 0;
    setSectionIndex(nextIndex);
    setElapsed(remaining);
    requestAnimationFrame(() => {
      if (audioRef.current) audioRef.current.currentTime = remaining;
    });
  };
  const restart = () => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    setElapsed(0);
  };
  const nextSection = async () => {
    if (sectionIndex + 1 < urls.length) {
      setSectionIndex((x) => x + 1);
      setElapsed(0);
      setPlaying(true);
    } else {
      setPlaying(false);
      await savePosition(true);
      await logActivity("audio", set.id, 1, qc, {
        duration_seconds: Math.round(sectionDuration),
        meta: { sessionId: session.id, mode: session.mode, title: session.title },
      });
      toast.success("Audio Study session complete");
    }
  };
  useEffect(() => {
    if (playing && audioRef.current && audioRef.current.paused) void audioRef.current.play();
  }, [sectionIndex, playing]);

  const send = async (question = input) => {
    const text = question.trim();
    if (!text || busy) return;
    audioRef.current?.pause();
    setPlaying(false);
    setInput("");
    setBusy("ask");
    const history = messages.slice(-8);
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const r = await ask({
        data: { sessionId: session.id, question: text, sectionIndex, history },
      });
      setMessages((m) => [...m, { role: "assistant", content: r.reply }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Momentum couldn't answer that.");
    } finally {
      setBusy(null);
    }
  };
  const makeQuiz = async () => {
    audioRef.current?.pause();
    setPlaying(false);
    setBusy("quiz");
    try {
      const q = await quizFn({ data: { sessionId: session.id, sectionIndex } });
      setQuiz({ ...q, answer: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create a question.");
    } finally {
      setBusy(null);
    }
  };
  const gradeQuiz = async (reveal = false) => {
    if (!quiz || !user || busy) return;
    setBusy("grade");
    try {
      const result = await gradeFn({
        data: { setId: set.id, question: quiz.question, answer: reveal ? "" : quiz.answer },
      });
      const first = !quiz.saved;
      setQuiz({ ...quiz, result, saved: true });
      if (first) {
        const score = GRADE[result.grade].score;
        await supabase
          .from("quiz_attempts")
          .insert({
            set_id: set.id,
            user_id: user.id,
            kind: "recall",
            difficulty: "mixed",
            score,
            total: 4,
            results: [
              {
                topic: quiz.topic,
                correct: score >= 3,
                grade: result.grade,
                q: quiz.question.slice(0, 200),
              },
            ],
          });
        await supabase
          .from("audio_study_events")
          .insert({
            user_id: user.id,
            session_id: session.id,
            kind: "quiz_result",
            content: quiz.answer || "(revealed)",
            context: {
              sectionIndex,
              topic: quiz.topic,
              question: quiz.question,
              grade: result.grade,
              model: result.model,
            },
          });
        void recordResults(
          user.id,
          [
            {
              setId: set.id,
              question: quiz.question,
              correct: score >= 3,
              studentAnswer: quiz.answer,
              correctAnswer: result.model,
              explanation: result.feedback,
              topic: quiz.topic,
              kind: "recall",
              data: {
                type: "recall",
                question: quiz.question,
                topic: quiz.topic,
                source: "audio-study",
              },
            },
          ],
          qc,
        );
        void logActivity("recall", set.id, 1, qc, {
          score: score >= 3 ? 1 : 0,
          total: 1,
          meta: {
            grade: result.grade,
            topic: quiz.topic,
            source: "audio-study",
            sessionId: session.id,
          },
        });
        qc.invalidateQueries({ queryKey: ["attempts", set.id] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Grading failed");
    } finally {
      setBusy(null);
    }
  };
  const audioMissing = missingSections(session).length > 0;
  const retryVoice = async () => {
    if (busy) return;
    setBusy("voice");
    try {
      const paths = await voiceLesson(voice, session, (d, t) =>
        setVoiceProgress(`Recording ${Math.min(d + 1, t)} of ${t}…`),
      );
      setSession({ ...session, audio_paths: paths, status: "ready", audio_error: null });
      qc.invalidateQueries({ queryKey: ["audio-study", set.id] });
      toast.success("Audio is ready");
    } catch (e) {
      const { data: fresh } = await supabase
        .from("audio_study_sessions")
        .select("*")
        .eq("id", session.id)
        .single();
      if (fresh) setSession(fresh);
      toast.error(e instanceof Error ? e.message : "Audio still couldn't be created.");
    } finally {
      setBusy(null);
      setVoiceProgress(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-mint">
            Audio Study · {MODES.find((m) => m.value === session.mode)?.title}
          </p>
          <h2 className="font-display text-3xl uppercase mt-1">{session.title}</h2>
          <p className="text-sm text-soft mt-1">
            {current
              ? `${sectionIndex + 1} of ${sections.length} · ${current.title}`
              : "Saved lesson"}
          </p>
        </div>
        <button onClick={onBack} className={btnGhost}>
          All sessions
        </button>
      </div>
      {session.status === "error" && (
        <ErrorBox msg={session.audio_error ?? "This lesson couldn't be generated."} />
      )}
      {audioMissing && session.script && session.status !== "error" && (
        <div className="rounded-xl border border-cool/30 bg-cool/10 p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-sm">Your lesson script is saved</p>
            <p className="text-xs text-soft mt-1">
              {session.audio_paths.length
                ? `Audio is ready for ${session.audio_paths.length} of ${sections.length} parts. Finish the rest to hear the whole lesson.`
                : "Audio hasn't been recorded yet. You can read the lesson now or record the audio."}
            </p>
          </div>
          <button onClick={retryVoice} disabled={!!busy} className={btnPrimary}>
            {busy === "voice" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}{" "}
            {busy === "voice"
              ? (voiceProgress ?? "Recording…")
              : session.audio_paths.length
                ? "Finish audio"
                : "Create audio"}
          </button>
        </div>
      )}
      {urls.length > 0 && current && (
        <div className="rounded-2xl dpanel p-5 space-y-4">
          <audio
            ref={audioRef}
            src={urls[sectionIndex]}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime;
              setElapsed(t);
              if (Math.abs(t - lastSaved.current) >= 15) void savePosition();
            }}
            onLoadedMetadata={(e) => setSectionDuration(e.currentTarget.duration)}
            onEnded={() => void nextSection()}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={restart}
              className="size-9 grid place-items-center rounded-lg border border-line/70"
              aria-label="Restart section"
            >
              <RotateCcw className="size-4" />
            </button>
            <button
              onClick={() => skip(-15)}
              className="size-9 grid place-items-center rounded-lg border border-line/70"
              aria-label="Skip back 15 seconds"
            >
              <SkipBack className="size-4" />
            </button>
            <button
              onClick={toggle}
              className="size-12 grid place-items-center rounded-full bg-brand text-ink"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="size-5 fill-current" />
              )}
            </button>
            <button
              onClick={() => skip(15)}
              className="size-9 grid place-items-center rounded-lg border border-line/70"
              aria-label="Skip forward 15 seconds"
            >
              <SkipForward className="size-4" />
            </button>
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={durations.reduce((sum, value) => sum + value, 0) || sectionDuration || 0}
                step={0.1}
                value={Math.min(
                  durations.slice(0, sectionIndex).reduce((sum, value) => sum + value, 0) + elapsed,
                  durations.reduce((sum, value) => sum + value, 0) || sectionDuration || 0,
                )}
                onChange={(e) => seekLesson(Number(e.target.value))}
                className="w-full accent-cool"
              />
              <div className="flex justify-between text-[11px] text-soft">
                <span>
                  {formatTime(
                    durations.slice(0, sectionIndex).reduce((sum, value) => sum + value, 0) +
                      elapsed,
                  )}
                </span>
                <span>
                  {formatTime(durations.reduce((sum, value) => sum + value, 0) || sectionDuration)}
                </span>
              </div>
            </div>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className={cn(inputCls, "w-20")}
              aria-label="Playback speed"
            >
              {[0.75, 1, 1.25, 1.5, 1.75, 2].map((x) => (
                <option key={x} value={x}>
                  {x}×
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-5">
        <section className="rounded-2xl bg-panel border border-line/70 p-5 space-y-4">
          <div>
            <p className="eyebrow text-cool2">Current topic</p>
            <h3 className="font-display text-2xl uppercase mt-1">
              {current?.title ?? "Lesson script"}
            </h3>
          </div>
          <div className="text-sm leading-relaxed max-h-[420px] overflow-y-auto pr-2">
            {current?.narration ?? <ReactMarkdown>{session.script}</ReactMarkdown>}
          </div>
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <button
                key={a}
                onClick={() => send(a)}
                disabled={!!busy}
                className="text-xs border border-line/70 rounded-lg px-3 py-2 text-soft hover:text-foreground"
              >
                {a}
              </button>
            ))}
            <button onClick={makeQuiz} disabled={!!busy} className={btnPrimary}>
              <AudioLines className="size-4" /> Quiz Me
            </button>
          </div>
        </section>
        <section className="rounded-2xl bg-panel border border-line/70 p-5 flex flex-col min-h-[430px]">
          <p className="eyebrow text-cool2 mb-3">Ask while you listen</p>
          <div className="flex-1 overflow-y-auto space-y-3 max-h-[420px]">
            {messages.length === 0 && !quiz && (
              <p className="text-sm text-soft">
                Pause anywhere and ask about what Momentum just explained.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-xl p-3 text-sm",
                  m.role === "user"
                    ? "ml-8 bg-cool/15 border border-cool/30"
                    : "border border-line/70 bg-foreground/5 md",
                )}
              >
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
            ))}
            {busy === "ask" && (
              <p className="text-sm text-soft inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Answering from your material…
              </p>
            )}
            {quiz && (
              <QuizPanel
                quiz={quiz}
                setQuiz={setQuiz}
                busy={busy === "grade"}
                onGrade={gradeQuiz}
                onContinue={() => {
                  setQuiz(null);
                  void toggle();
                }}
              />
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex gap-2 mt-4"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this part…"
              className={cn(inputCls, "flex-1")}
            />
            <button disabled={!!busy || !input.trim()} className={btnPrimary} aria-label="Send">
              <Send className="size-4" />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function QuizPanel({
  quiz,
  setQuiz,
  busy,
  onGrade,
  onContinue,
}: {
  quiz: {
    question: string;
    topic: string;
    model: string;
    answer: string;
    result?: { grade: RecallGrade; feedback: string; model: string };
    saved?: boolean;
  };
  setQuiz: (q: typeof quiz | null) => void;
  busy: boolean;
  onGrade: (reveal?: boolean) => void;
  onContinue: () => void;
}) {
  return (
    <div className="rounded-xl border border-cool/40 bg-cool/10 p-4 space-y-3">
      <p className="eyebrow text-cool2">Quiz Me · {quiz.topic}</p>
      <p className="font-semibold text-sm">{quiz.question}</p>
      <textarea
        rows={3}
        value={quiz.answer}
        onChange={(e) => setQuiz({ ...quiz, answer: e.target.value })}
        disabled={!!quiz.result || busy}
        className={cn(inputCls, "w-full")}
        placeholder="Answer from memory…"
      />
      {quiz.result && (
        <div
          className={cn("rounded-lg border p-3 text-sm space-y-1", GRADE[quiz.result.grade].tone)}
        >
          <p className="font-semibold">{GRADE[quiz.result.grade].label}</p>
          <p className="text-foreground">{quiz.result.feedback}</p>
          <p className="text-foreground">
            <span className="text-soft">Answer: </span>
            {quiz.result.model}
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!quiz.result ? (
          <>
            <button
              onClick={() => onGrade(false)}
              disabled={busy || !quiz.answer.trim()}
              className={btnPrimary}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Check answer
            </button>
            <button onClick={() => onGrade(true)} disabled={busy} className={btnGhost}>
              Show answer
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                const { result: _result, ...retry } = quiz;
                setQuiz(retry);
              }}
              className={btnGhost}
            >
              Try Again
            </button>
            <button onClick={onContinue} className={btnPrimary}>
              Continue Audio
            </button>
          </>
        )}
      </div>
    </div>
  );
}
