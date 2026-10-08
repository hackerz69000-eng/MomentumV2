import { useEffect, useRef, useState } from "react";
import type { SaveState } from "@/components/SaveStatus";

/** Debounced autosave. `save` should throw on failure. Skips the initial value. Ignores stale resolutions so "Saved" only reflects the latest content. */
export function useAutosave<T>(value: T, save: (v: T) => Promise<void>, delay = 1200): SaveState {
  const [state, setState] = useState<SaveState>("idle");
  const first = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;
  const gen = useRef(0);
  const key = JSON.stringify(value);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const g = ++gen.current;
    setState("saving");
    const t = setTimeout(() => {
      saveRef.current(value).then(
        () => {
          if (gen.current === g) setState("saved");
        },
        () => {
          if (gen.current === g) setState("error");
        },
      );
    }, delay);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state !== "saving") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);
  return state;
}
