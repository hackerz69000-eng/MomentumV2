/** Server-only quota reservation and provider usage accounting. */
export type MeteredProvider = "nvidia" | "deepgram_asr" | "deepgram_tts";
export type UsageReservation = { id: string; provider: MeteredProvider; startedAt: number; inputUnits: number };

export class ProviderLimitError extends Error {
  readonly status = 429;
  constructor(message: string) { super(message); this.name = "ProviderLimitError"; }
}

function errorText(error: unknown): string {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : "";
}

export async function reserveProviderUsage(
  supabase: any,
  provider: MeteredProvider,
  inputUnits: number,
): Promise<UsageReservation> {
  if (!Number.isSafeInteger(inputUnits) || inputUnits < 0) throw new Error("Invalid provider usage size.");
  const { data, error } = await supabase.rpc("reserve_provider_usage", {
    p_provider: provider,
    p_input_units: inputUnits,
  });
  if (error) {
    const message = errorText(error);
    if (message.includes("PROVIDER_DAILY_QUOTA_EXCEEDED")) {
      throw new ProviderLimitError("You've reached today's AI usage limit. Try again tomorrow.");
    }
    if (message.includes("PROVIDER_CONCURRENCY_LIMIT")) {
      throw new ProviderLimitError("Too many AI requests are running at once. Wait for one to finish and try again.");
    }
    if (message.includes("PROVIDER_REQUEST_TOO_LARGE")) {
      throw new ProviderLimitError("This request is larger than the provider usage limit allows.");
    }
    // Fail closed: provider calls must never proceed when durable quota state is unavailable.
    throw new Error("Usage limits couldn't be checked. Please try again shortly.");
  }
  if (typeof data !== "string" || !data) throw new Error("Usage reservation could not be confirmed.");
  return { id: data, provider, startedAt: Date.now(), inputUnits };
}

function rate(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Rates are optional, non-secret USD values; estimates stay explicitly incomplete until configured. */
export function estimateProviderCost(provider: MeteredProvider, inputUnits: number, outputUnits: number) {
  let usd: number | null = null;
  if (provider === "nvidia") {
    const inputRate = rate("NVIDIA_INPUT_USD_PER_1M_TOKENS");
    const outputRate = rate("NVIDIA_OUTPUT_USD_PER_1M_TOKENS");
    if (inputRate !== null && outputRate !== null) {
      usd = (Math.ceil(inputUnits / 4) * inputRate + Math.ceil(outputUnits / 4) * outputRate) / 1_000_000;
    }
  } else if (provider === "deepgram_asr") {
    const hourlyRate = rate("DEEPGRAM_ASR_USD_PER_HOUR");
    if (hourlyRate !== null) usd = Math.max(0, inputUnits - 44) / 32_000 / 3_600 * hourlyRate;
  } else {
    const ratePerThousand = rate("DEEPGRAM_TTS_USD_PER_1000_CHARS");
    if (ratePerThousand !== null) usd = inputUnits / 1_000 * ratePerThousand;
  }
  return {
    micros: usd === null ? 0 : Math.max(0, Math.ceil(usd * 1_000_000)),
    complete: usd !== null,
  };
}

export async function completeProviderUsage(
  supabase: any,
  reservation: UsageReservation,
  status: "success" | "failure" | "cancelled",
  outputUnits = 0,
): Promise<void> {
  const cost = estimateProviderCost(reservation.provider, reservation.inputUnits, outputUnits);
  const { error } = await supabase.rpc("complete_provider_usage", {
    p_reservation_id: reservation.id,
    p_status: status,
    p_latency_ms: Math.max(0, Math.min(900_000, Date.now() - reservation.startedAt)),
    p_output_units: Math.max(0, Math.floor(outputUnits)),
    p_estimated_cost_micros: cost.micros,
    p_cost_estimate_complete: cost.complete,
  });
  if (error) throw new Error("Provider usage could not be recorded.");
}

/** Preserve the upstream stream while releasing concurrency and recording its outcome on close/cancel. */
export function meterProviderStream(
  supabase: any,
  body: ReadableStream<Uint8Array>,
  reservation: UsageReservation,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let outputUnits = 0;
  let eventBuffer = "";
  let sawDone = false;
  let settled = false;
  const inspectSse = (text: string) => {
    eventBuffer += text;
    const events = eventBuffer.split(/\r?\n\r?\n/);
    eventBuffer = (events.pop() ?? "").slice(-256_000);
    if (events.some((event) => event.split(/\r?\n/).some((line) => /^data:\s*\[DONE\]\s*$/.test(line)))) sawDone = true;
  };
  const settle = async (status: "success" | "failure" | "cancelled") => {
    if (settled) return;
    settled = true;
    try { await completeProviderUsage(supabase, reservation, status, outputUnits); }
    catch (error) { console.error("[provider-usage] Could not finalize usage reservation:", error instanceof Error ? error.message : "unknown error"); }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          const tail = decoder.decode();
          outputUnits += tail.length;
          inspectSse(tail);
          await settle(sawDone ? "success" : "failure");
          controller.close();
          return;
        }
        const text = decoder.decode(result.value, { stream: true });
        outputUnits += text.length;
        inspectSse(text);
        controller.enqueue(result.value);
      } catch (error) {
        await settle("failure");
        controller.error(error);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } finally { await settle("cancelled"); }
    },
  });
}
