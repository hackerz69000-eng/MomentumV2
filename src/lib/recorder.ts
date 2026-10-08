// Browser lecture recorder: captures PCM via Web Audio, downsamples to 16 kHz mono and
// emits complete WAV segments (each decodable on its own) for transcription.
import { supabase } from "@/integrations/supabase/client";

const TARGET_RATE = 16000;
export const SEGMENT_SECONDS = 60; // short segments so a crash loses at most ~1 minute of audio

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const tag = (o: number, v: string) => {
    for (let i = 0; i < v.length; i++) view.setUint8(o + i, v.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (const v of samples) {
    const s = Math.max(-1, Math.min(1, v));
    view.setInt16(o, s * (s < 0 ? 32768 : 32767), true);
    o += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}

function downsample(chunk: Float32Array, from: number): Float32Array {
  if (from === TARGET_RATE) return chunk;
  const ratio = from / TARGET_RATE;
  const out = new Float32Array(Math.floor(chunk.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio),
      end = Math.min(chunk.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += chunk[j]!;
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export type Recorder = {
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  level: () => number;
};

export function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access was blocked. Allow the microphone for this site in your browser's address bar, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No microphone was found. Connect a microphone and try again.";
  if (name === "NotReadableError")
    return "Your microphone is being used by another app. Close it and try again.";
  if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia)
    return "This browser can't record audio. Try the latest Chrome, Edge, Firefox or Safari.";
  return e instanceof Error ? e.message : "Couldn't start recording.";
}

export async function startRecorder(
  onSegment: (wav: File, index: number) => void,
): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "This browser can't record audio. Try the latest Chrome, Edge, Firefox or Safari.",
    );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  let buf: Float32Array[] = [];
  let bufLen = 0;
  let paused = false;
  let index = 0;
  let lvl = 0;
  const flush = (force = false) => {
    if (!bufLen || (!force && bufLen < SEGMENT_SECONDS * TARGET_RATE)) return;
    const all = new Float32Array(bufLen);
    let o = 0;
    for (const c of buf) {
      all.set(c, o);
      o += c.length;
    }
    buf = [];
    bufLen = 0;
    if (all.length < TARGET_RATE) return; // ignore <1s tails
    onSegment(
      new File([encodeWav(all, TARGET_RATE)], `segment-${index + 1}.wav`, { type: "audio/wav" }),
      index++,
    );
  };
  node.onaudioprocess = (ev) => {
    const data = ev.inputBuffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i += 16) peak = Math.max(peak, Math.abs(data[i]!));
    lvl = peak;
    if (paused) return;
    const d = downsample(new Float32Array(data), ctx.sampleRate);
    buf.push(d);
    bufLen += d.length;
    flush();
  };
  source.connect(node);
  node.connect(ctx.destination);
  return {
    level: () => (paused ? 0 : lvl),
    pause: async () => {
      paused = true;
    },
    resume: async () => {
      paused = false;
    },
    stop: async () => {
      paused = true;
      flush(true);
      node.onaudioprocess = null;
      node.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}

/** Sends one WAV segment to the transcription endpoint. */
export async function transcribeSegment(
  file: File,
  onDelta: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: signal ?? null,
  });
  if (!res.ok) {
    let msg = `Transcription failed (${res.status})`;
    try {
      const j = await res.json();
      msg = j?.error?.message ?? j?.error ?? j?.message ?? msg;
    } catch {
      /* ignore malformed error bodies */
    }
    if (res.status === 429) msg = "Transcription is busy right now. Please try again in a minute.";
    throw new Error(typeof msg === "string" ? msg : "Transcription failed");
  }
  const result = (await res.json()) as { text?: string };
  const text = result.text?.trim() ?? "";
  if (!text) throw new Error("The transcription ended without any text. The audio may be silent.");
  onDelta(text);
  return text;
}
