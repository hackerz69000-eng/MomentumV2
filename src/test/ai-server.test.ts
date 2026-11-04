import { afterEach, describe, expect, it, vi } from "vitest";
import { aiText, parseJson, splitTextIntoChunks } from "../lib/ai.server";

describe("parseJson", () => {
  it("reads JSON wrapped in prose and a Markdown fence", () => {
    expect(parseJson<{ ok: boolean }>(`Here is the result:\n\`\`\`json\n{"ok":true}\n\`\`\``)).toEqual({ ok: true });
  });

  it("handles nested values and braces inside JSON strings", () => {
    expect(parseJson<{ message: string; nested: { values: number[] } }>(
      `Result: {"message":"brace } and bracket ] are text","nested":{"values":[1,2,3]}} done`,
    )).toEqual({ message: "brace } and bracket ] are text", nested: { values: [1, 2, 3] } });
  });

  it("skips bracketed labels before the real JSON payload", () => {
    expect(parseJson<{ questions: number[] }>(`[JSON output]\n{\"questions\":[1,2,3]}`)).toEqual({ questions: [1, 2, 3] });
  });

  it("rejects empty and malformed responses rather than returning partial data", () => {
    expect(() => parseJson("  ")).toThrow(/empty/i);
    expect(() => parseJson(`{"items":[1,2}`)).toThrow(/read the AI response/i);
  });
});

describe("splitTextIntoChunks", () => {
  it("keeps all text and bounds chunks even when a block is oversized", () => {
    const source = `BEGIN\n\n${"x".repeat(31)}\n\nMIDDLE\n\nEND`;
    const chunks = splitTextIntoChunks(source, 10);
    expect(chunks.join("")).toContain("BEGIN");
    expect(chunks.join("")).toContain("MIDDLE");
    expect(chunks.join("")).toContain("END");
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
  });

  it("uses a safe minimum for invalid chunk sizes", () => {
    expect(splitTextIntoChunks("abc", 0)).toEqual(["a", "b", "c"]);
    expect(splitTextIntoChunks("abc", Number.NaN)).toEqual(["abc"]);
    expect(splitTextIntoChunks("  ")).toEqual([]);
  });
});


describe("aiText NVIDIA SSE transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("aggregates streamed deltas without losing token whitespace", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } })));

    await expect(aiText("system", [{ role: "user", content: "question" }], { retries: 0 }))
      .resolves.toBe("Hello world");
  });

  it("rejects a truncated stream instead of returning a partial answer", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    const encoder = new TextEncoder();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } })));

    await expect(aiText("system", [{ role: "user", content: "question" }], { retries: 0 }))
      .rejects.toThrow(/before completing/i);
  });
});
