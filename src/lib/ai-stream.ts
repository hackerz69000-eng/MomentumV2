import { createClientOnlyFn } from "@tanstack/react-start";

// Keep the browser streaming implementation out of TanStack Start's SSR bundle.
// The compiler replaces these functions with server-side guards and retains the
// actual implementation only in the browser build.
type StreamTextOptions = Parameters<typeof import("./ai-stream.client").streamAiText>[0];
type StreamJsonOptions<T> = {
  system: string;
  messages: { role: "user" | "assistant"; content: string | import("./ai-stream.client").StreamContentPart[] }[];
  task?: "fast" | "reasoning" | "vision";
  requestId?: string;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  validate: (value: unknown) => T;
};
type PreparedNotesOptions = Parameters<typeof import("./ai-stream.client").streamPreparedNotes>[0];

export const streamAiText = createClientOnlyFn(async (options: StreamTextOptions) => {
  const client = await import("./ai-stream.client");
  return client.streamAiText(options);
});

export const streamAiJson = createClientOnlyFn(async <T>(options: StreamJsonOptions<T>): Promise<T> => {
  const client = await import("./ai-stream.client");
  return client.streamAiJson<T>(options);
});

export const streamPreparedNotes = createClientOnlyFn(async (options: PreparedNotesOptions) => {
  const client = await import("./ai-stream.client");
  return client.streamPreparedNotes(options);
});
