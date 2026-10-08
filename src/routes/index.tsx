import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowDown,
  BookOpen,
  Target,
  Search,
  Compass,
  Mic,
  PenLine,
  MessageSquare,
  Layers,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Momentum — Your entire study process, powered by AI" },
      {
        name: "description",
        content:
          "Turn your course materials into a personalized study system: understand, practice, find your weaknesses and prepare for exams.",
      },
      { property: "og:title", content: "Momentum — Your entire study process, powered by AI" },
      {
        property: "og:description",
        content:
          "More than a chatbot or flashcard generator: one connected study system built from your own course material.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const WORKFLOW = [
  {
    name: "Understand",
    tone: "text-cool2",
    items: ["AI Notes", "Study Guides", "Explain This", "Ask Your Materials", "Lecture Mode"],
  },
  {
    name: "Practice",
    tone: "text-mint",
    items: [
      "Smart Flashcards",
      "Active Recall",
      "AI Quizzes",
      "Adaptive Quizzes",
      "Practice Exams",
    ],
  },
  {
    name: "Improve",
    tone: "text-destructive",
    items: ["Mistake Bank", "Weak Topic Detection", "Performance Tracking", "Study History"],
  },
  {
    name: "Prepare",
    tone: "text-violet",
    items: [
      "Test Readiness",
      "Study Plans",
      "Momentum Coach",
      "Study Everything",
      "Comprehensive Exams",
    ],
  },
];

const LOOP = [
  "Your materials",
  "Practice",
  "Performance",
  "Weak topics",
  "Personalized review",
  "Exam preparation",
];

const FEATURES = [
  {
    icon: BookOpen,
    t: "Learn from your materials",
    items: [
      "Learn from PDFs, DOCX, PPTX, TXT, pasted notes and lectures",
      "Generate notes and study guides",
      "Ask questions about your materials",
      "Explain difficult concepts at your level",
    ],
  },
  {
    icon: Target,
    t: "Practice intelligently",
    items: [
      "Smart flashcards with spaced review",
      "Active Recall",
      "AI and adaptive quizzes",
      "Practice and comprehensive exams",
    ],
  },
  {
    icon: Search,
    t: "Find what you don't know",
    items: ["Mistake Bank", "Weak topic detection", "Performance tracking", "Test Readiness"],
  },
  {
    icon: Compass,
    t: "Know what to study next",
    items: [
      "Study Plan",
      "Momentum Coach",
      "Study Everything",
      "Recommendations based on your results",
    ],
  },
  {
    icon: Mic,
    t: "Turn lectures into study material",
    items: [
      "Record lectures",
      "Editable transcripts",
      "Notes, flashcards and quizzes from each lecture",
    ],
  },
  {
    icon: PenLine,
    t: "Write better",
    items: [
      "Assignment Helper",
      "Essay Grader",
      "Rubric-aware feedback",
      "Suggestions that keep your own voice",
    ],
  },
];

function Landing() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const effectiveUser = mounted ? user : null;
  const cta = effectiveUser ? "/dashboard" : "/auth";
  const ctaLabel = effectiveUser ? "Go to dashboard" : "Start Studying";
  return (
    <div className="min-h-screen bg-ink flex flex-col">
      <header className="flex items-center justify-between px-6 md:px-10 py-6 max-w-6xl mx-auto w-full">
        <BrandLogo />
        <Link
          to={cta}
          className="text-sm font-semibold border border-line px-4 py-2 rounded-lg hover:bg-accent"
        >
          {effectiveUser ? "Dashboard" : "Log in"}
        </Link>
      </header>

      <main className="flex-1 px-6 md:px-10 pb-16 max-w-6xl mx-auto w-full">
        {/* Hero */}
        <section className="grid lg:grid-cols-[1.15fr_1fr] gap-16 items-center pt-10 md:pt-16">
          <div>
            <span className="eyebrow text-cool2">An AI study system — not a chatbot</span>
            <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold leading-[1.04] mt-5">
              Your entire study process, <span className="text-cool2">powered by AI.</span>
            </h1>
            <p className="text-soft text-lg mt-6 max-w-xl leading-relaxed">
              Turn your course materials into a personalized study system — understand your
              material, practice it, find your weaknesses, and prepare for your exams.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link
                to={cta}
                className="inline-flex items-center gap-2 font-semibold bg-primary text-primary-foreground px-6 py-3 rounded-lg hover:bg-cool2 transition-colors"
              >
                {ctaLabel} <ArrowRight className="size-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex items-center gap-2 font-semibold bg-panel border border-line px-6 py-3 rounded-lg hover:bg-accent"
              >
                See How It Works <ArrowDown className="size-4" />
              </a>
            </div>
          </div>
          <div
            className="rounded-xl p-7 bg-panel border border-line shadow-2xl"
            aria-label="Example of the Recommended now panel"
          >
            <div className="flex justify-between items-center mb-3">
              <p className="eyebrow text-cool2">Recommended now</p>
              <span className="text-[10px] uppercase tracking-wider text-soft">Example</span>
            </div>
            <p className="font-display text-2xl font-bold leading-tight">
              Review Constitutional Law
            </p>
            <p className="text-soft text-sm mt-1">Weak topic · flashcards due · exam in 6 days</p>
            <div className="mt-5 flex items-center justify-between text-sm">
              <span className="text-soft">Test readiness</span>
              <span className="font-display font-bold text-cool2 text-xl">72%</span>
            </div>
            <div className="h-2 rounded-full bg-foreground/10 mt-2">
              <div className="h-full w-[72%] rounded-full bg-progress" />
            </div>
            <ul className="mt-5 space-y-2 text-sm">
              <li className="flex justify-between rounded-lg bg-accent border border-line px-3 py-2">
                <span>1. Due flashcards</span>
                <span className="text-soft">~6 min</span>
              </li>
              <li className="flex justify-between rounded-lg bg-accent border border-line px-3 py-2">
                <span>2. Active Recall · weak topics</span>
                <span className="text-soft">~8 min</span>
              </li>
              <li className="flex justify-between rounded-lg bg-accent border border-line px-3 py-2">
                <span>3. Retry past mistakes</span>
                <span className="text-soft">~4 min</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Workflow */}
        <section id="how" className="mt-24 scroll-mt-8" aria-labelledby="how-h">
          <p className="eyebrow text-soft">How it works</p>
          <h2 id="how-h" className="font-display text-3xl md:text-5xl font-bold mt-2">
            Understand → Practice → Improve → Prepare
          </h2>
          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {WORKFLOW.map((g, i) => (
              <div
                key={g.name}
                className="rounded-xl p-6 bg-panel border border-line transition-colors hover:border-cool/40"
              >
                <p className={`font-display font-bold text-xl ${g.tone}`}>
                  <span className="text-soft mr-2">0{i + 1}</span>
                  {g.name}
                </p>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {g.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* One study system */}
        <section className="mt-24 grid lg:grid-cols-2 gap-10 items-center" aria-labelledby="sys-h">
          <div>
            <p className="eyebrow text-mint">One study system</p>
            <h2 id="sys-h" className="font-display text-3xl md:text-5xl uppercase mt-2">
              Momentum learns how you study.
            </h2>
            <p className="text-soft mt-5 leading-relaxed max-w-lg">
              Its tools aren't separate. Your results from quizzes, flashcards, Active Recall, exams
              and missed questions are tracked per topic. That's what drives your weak-topic list,
              your Test Readiness estimate, and what the Coach, Study Plan and Study Everything
              recommend next.
            </p>
            <p className="text-soft mt-3 text-sm max-w-lg">
              It only uses your study activity inside Momentum — nothing else about you.
            </p>
          </div>
          <ol className="space-y-2">
            {LOOP.map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className="size-8 shrink-0 rounded-full border border-cool/40 grid place-items-center text-xs font-semibold text-cool2">
                  {i + 1}
                </span>
                <span className="flex-1 rounded-xl bg-panel border border-line/70 px-4 py-2.5 font-semibold">
                  {s}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* Features */}
        <section className="mt-24" aria-labelledby="feat-h">
          <h2 id="feat-h" className="font-display text-3xl md:text-5xl uppercase">
            What's inside
          </h2>
          <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.t} className="rounded-2xl p-6 bg-panel border border-line/70">
                <f.icon className="size-6 text-cool2" aria-hidden />
                <h3 className="font-display text-xl uppercase mt-3">{f.t}</h3>
                <ul className="mt-3 space-y-1.5 text-sm text-soft">
                  {f.items.map((it) => (
                    <li key={it}>· {it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Not a chatbot */}
        <section className="mt-24 rounded-3xl dpanel p-6 md:p-10" aria-labelledby="diff-h">
          <h2 id="diff-h" className="font-display text-3xl md:text-5xl uppercase">
            More than an AI chatbot.
          </h2>
          <div className="mt-6 grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-foreground/5 p-5">
              <p className="inline-flex items-center gap-2 font-semibold">
                <MessageSquare className="size-4 text-soft" /> A chatbot
              </p>
              <p className="text-sm text-soft mt-2">
                Answers the question you ask, then forgets it. You decide what to study and keep
                track of everything yourself.
              </p>
            </div>
            <div className="rounded-2xl bg-cool/10 border border-cool/30 p-5">
              <p className="inline-flex items-center gap-2 font-semibold">
                <Layers className="size-4 text-cool2" /> Momentum
              </p>
              <p className="text-sm mt-2">
                Doesn't just answer questions. It connects studying into one workflow — from
                learning the material to practicing it, identifying weaknesses, reviewing them, and
                preparing for exams.
              </p>
            </div>
          </div>
          <p className="mt-6 text-sm font-semibold text-cool2 flex flex-wrap gap-x-2 gap-y-1">
            {LOOP.map((s, i) => (
              <span key={s}>
                {i ? "→ " : ""}
                {s}
              </span>
            ))}
          </p>
        </section>

        {/* Final CTA */}
        <section className="mt-24 text-center" aria-labelledby="cta-h">
          <h2 id="cta-h" className="font-display text-4xl md:text-6xl uppercase">
            Ready to study smarter?
          </h2>
          <p className="text-soft mt-4 max-w-xl mx-auto">
            Bring your course material into Momentum and build your personalized study system.
          </p>
          <Link
            to={cta}
            className="inline-flex items-center gap-2 mt-8 font-semibold bg-brand text-ink px-8 py-3.5 rounded-lg"
          >
            {ctaLabel} <ArrowRight className="size-4" />
          </Link>
        </section>
      </main>
    </div>
  );
}
