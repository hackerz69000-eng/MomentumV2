import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertGenerationClaimed, assertGenerationSourceRevision } from "@/lib/study-generation-lock";
import { uploadQuizCacheAsset } from "@/lib/extract";

const safetyMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261105000000_study_generation_safety.sql"), "utf8");
const cacheMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261104000000_study_engine_cache_and_checkpoints.sql"), "utf8");

describe("study generation safety", () => {
  it("allows one atomic claim and rejects a simultaneous competing claim", async () => {
    let serializedClaims = 0;
    const simulatedDatabaseClaim = async () => {
      await Promise.resolve();
      serializedClaims += 1;
      return serializedClaims === 1;
    };
    const results = await Promise.all([0, 1].map(async () => {
      try {
        assertGenerationClaimed(await simulatedDatabaseClaim(), null);
        return "claimed";
      } catch (error) {
        return error instanceof Error ? error.message : "unexpected";
      }
    }));
    expect(results.filter((result) => result === "claimed")).toHaveLength(1);
    expect(results.find((result) => result !== "claimed")).toMatch(/already generating/i);
    expect(safetyMigration).toMatch(/ON CONFLICT \(set_id\) DO UPDATE[\s\S]*WHERE existing\.expires_at <= now\(\)/i);
  });

  it("rejects a result when the source revision changed before commit", () => {
    expect(() => assertGenerationSourceRevision("revision-before", "revision-after"))
      .toThrow(/outdated result was not saved/i);
    expect(safetyMigration).toMatch(/v_set\.generation_source_revision <> p_source_revision/i);
    expect(safetyMigration).toMatch(/FOR UPDATE;[\s\S]*v_set\.generation_source_revision/i);
  });

  it("lets expired locks be reclaimed and renews active locks", () => {
    expect(safetyMigration).toMatch(/expires_at <= now\(\)/i);
    expect(safetyMigration).toMatch(/now\(\) \+ interval '2 minutes'/i);
    expect(safetyMigration).toMatch(/UPDATE public\.study_set_generation_locks[\s\S]*SET expires_at = now\(\)/i);
    expect(safetyMigration).toMatch(/DELETE FROM public\.study_set_generation_locks[\s\S]*lock_token = p_lock_token/i);
  });

  it("writes visual cache objects without upsert and can reuse an existing private object", async () => {
    const upload = vi.fn(async (_path: string, _blob: Blob, _options: { contentType: string }) => ({ error: { message: "Object already exists" } }));
    const canReadExisting = vi.fn(async () => true);
    const path = "user-id/_engine-cache/hash/v1/quiz-1.jpg";
    const blob = new Blob(["visual"], { type: "image/jpeg" });
    const write = () => upload(path, blob, { contentType: "image/jpeg" });

    const created = await uploadQuizCacheAsset(write, canReadExisting);

    expect(created).toBe(false);
    expect(upload).toHaveBeenCalledWith(path, blob, { contentType: "image/jpeg" });
    expect(canReadExisting).toHaveBeenCalledOnce();
    expect(cacheMigration).not.toMatch(/CREATE POLICY[\s\S]*ON storage\.objects[\s\S]*FOR UPDATE/i);
  });
});
