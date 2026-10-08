import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { HelpCircle, Loader2 } from "lucide-react";
import { explainWhy } from "@/lib/explain.functions";

/** "Explain why" button + inline explanation. Doesn't interrupt the activity. */
export function ExplainWhy(props: {
  setId: string;
  lectureId?: string | undefined;
  question: string;
  options?: string[];
  correct: string;
  given?: string;
  topic?: string;
}) {
  const fn = useServerFn(explainWhy);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      setText(
        (
          await fn({
            data: {
              setId: props.setId,
              lectureId: props.lectureId,
              question: props.question,
              options: props.options ?? [],
              correct: props.correct,
              given: props.given ?? "",
              topic: props.topic ?? "",
            },
          })
        ).text,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load an explanation. Try again.");
    }
    setBusy(false);
  };
  if (text)
    return (
      <div className="md text-sm rounded-lg border border-cool/30 bg-cool/5 p-3 mt-3">
        <ReactMarkdown>{text}</ReactMarkdown>
      </div>
    );
  return (
    <div className="mt-2">
      <button
        onClick={go}
        disabled={busy}
        className="text-xs font-semibold text-cool2 hover:underline inline-flex items-center gap-1 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <HelpCircle className="size-3" />}{" "}
        Explain why
      </button>
      {err && <p className="text-xs text-destructive mt-1">{err}</p>}
    </div>
  );
}
