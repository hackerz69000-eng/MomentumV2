import { Check, CloudOff, Loader2 } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** Subtle autosave indicator. */
export function SaveStatus({ state }: { state: SaveState }) {
  if (state === "idle")
    return <span className="text-xs text-soft self-center">Changes save automatically</span>;
  if (state === "saving")
    return (
      <span className="text-xs text-soft self-center inline-flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" /> Saving…
      </span>
    );
  if (state === "saved")
    return (
      <span className="text-xs text-mint self-center inline-flex items-center gap-1">
        <Check className="size-3" /> Saved
      </span>
    );
  return (
    <span className="text-xs text-destructive self-center inline-flex items-center gap-1">
      <CloudOff className="size-3" /> Not saved yet — your text is still here
    </span>
  );
}
