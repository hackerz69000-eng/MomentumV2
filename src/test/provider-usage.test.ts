import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeProviderUsage,
  estimateProviderCost,
  meterProviderStream,
  ProviderLimitError,
  reserveProviderUsage,
} from "@/lib/provider-usage.server";

describe("provider usage metering", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when the durable reservation RPC is unavailable", async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "database unavailable" } }) };
    await expect(reserveProviderUsage(supabase, "nvidia", 20)).rejects.toThrow(/limits couldn't be checked/i);
    expect(supabase.rpc).toHaveBeenCalledOnce();
  });

  it("maps quota denials and rejects invalid request sizes before RPC", async () => {
    const denied = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "PROVIDER_DAILY_QUOTA_EXCEEDED" } }) };
    await expect(reserveProviderUsage(denied, "deepgram_tts", 10)).rejects.toBeInstanceOf(ProviderLimitError);
    const unused = { rpc: vi.fn() };
    await expect(reserveProviderUsage(unused, "nvidia", -1)).rejects.toThrow(/invalid provider usage/i);
    expect(unused.rpc).not.toHaveBeenCalled();
  });

  it("records a streamed success only after all bytes have reached the consumer", async () => {
    const calls: unknown[][] = [];
    const supabase = { rpc: vi.fn(async (...args: unknown[]) => { calls.push(args); return { error: null, data: true }; }) };
    const reservation = { id: "reservation", provider: "nvidia" as const, startedAt: Date.now(), inputUnits: 20 };
    const bytes = new TextEncoder().encode("data: {\"delta\":\"é\"}\n\ndata: [DONE]\n\n");
    const stream = meterProviderStream(supabase, new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), reservation);
    const received = await new Response(stream).text();
    expect(received).toContain("é");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("complete_provider_usage");
    expect((calls[0]?.[1] as Record<string, unknown>).p_status).toBe("success");
  });

  it("marks incomplete cost estimates until non-secret provider rates are configured", () => {
    expect(estimateProviderCost("nvidia", 400, 400).complete).toBe(false);
    vi.stubEnv("NVIDIA_INPUT_USD_PER_1M_TOKENS", "1");
    vi.stubEnv("NVIDIA_OUTPUT_USD_PER_1M_TOKENS", "2");
    expect(estimateProviderCost("nvidia", 400, 400)).toEqual({ micros: 300, complete: true });
  });

  it("finalizes failed requests through the authenticated accounting RPC", async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: null, data: true }) };
    await completeProviderUsage(supabase, { id: "r", provider: "deepgram_asr", startedAt: Date.now(), inputUnits: 32_044 }, "failure");
    expect(supabase.rpc).toHaveBeenCalledWith("complete_provider_usage", expect.objectContaining({ p_status: "failure" }));
  });

  it("does not mistake response text containing a done marker for a completed SSE event", async () => {
    const supabase = { rpc: vi.fn(async (_name: string, _params: Record<string, unknown>) => ({ error: null, data: true })) };
    const reservation = { id: "r", provider: "nvidia" as const, startedAt: Date.now(), inputUnits: 10 };
    const content = new TextEncoder().encode('data: {"delta":"the phrase data: [DONE] is an example"}\n\n');
    const stream = meterProviderStream(supabase, new ReadableStream({ start(c) { c.enqueue(content); c.close(); } }), reservation);
    await new Response(stream).text();
    expect((supabase.rpc.mock.calls[0]?.[1] as Record<string, unknown>).p_status).toBe("failure");
  });

  it("releases a provider reservation when the downstream reader cancels", async () => {
    const supabase = { rpc: vi.fn(async (_name: string, _params: Record<string, unknown>) => ({ error: null, data: true })) };
    const reservation = { id: "r", provider: "nvidia" as const, startedAt: Date.now(), inputUnits: 10 };
    const stream = meterProviderStream(supabase, new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("partial")); } }), reservation);
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect((supabase.rpc.mock.calls[0]?.[1] as Record<string, unknown>).p_status).toBe("cancelled");
  });
});
