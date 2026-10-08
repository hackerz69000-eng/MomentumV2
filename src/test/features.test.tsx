import { describe, expect, it, beforeEach } from "vitest";
import {
  signUpLocal,
  signInLocal,
  signOutLocal,
  getActiveUser,
  getLocalUsers,
} from "@/lib/local-auth";
import {
  generate20Flashcards,
  generateNotesFromMaterial,
} from "@/lib/study-generator";
import { RPG_RANKS } from "@/components/Levels";
import {
  getStreakData,
  recordStudySessionCompletion,
} from "@/components/DailyStreak";
import {
  getDailyGoals,
  saveDailyGoals,
  type StudyGoal,
} from "@/components/DailyStudyGoals";
import {
  getSessionHistory,
  addSessionRecord,
} from "@/components/SessionHistory";
import { schedule } from "@/lib/stats";

describe("Momentum Local Authentication & Feature Suite", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("Local Authentication", () => {
    it("signs up a new user, hashes password, and sets active user in localStorage", () => {
      const res = signUpLocal("alexstudent", "mypassword123");
      expect(res.user.username).toBe("alexstudent");
      expect(res.user.email).toBe("alexstudent@local.momentum");

      const active = getActiveUser();
      expect(active?.username).toBe("alexstudent");

      const storedUsers = getLocalUsers();
      expect(storedUsers.length).toBe(1);
      expect(storedUsers[0]?.username).toBe("alexstudent");
      // Password must be hashed, not stored in plaintext
      expect(storedUsers[0]?.passwordHash).not.toBe("mypassword123");
    });

    it("signs in an existing user with matching password and rejects invalid passwords", () => {
      signUpLocal("janedoe", "correctpass");
      signOutLocal();
      expect(getActiveUser()).toBeNull();

      expect(() => signInLocal("janedoe", "wrongpass")).toThrow("Incorrect password");
      expect(getActiveUser()).toBeNull();

      const signinRes = signInLocal("janedoe", "correctpass");
      expect(signinRes.user.username).toBe("janedoe");
      expect(getActiveUser()?.username).toBe("janedoe");
    });
  });

  describe("20 Flashcards & Structured Note Generation", () => {
    const sampleMaterial = `
Cellular Respiration and Energy Production

Cellular Respiration is defined as the biochemical process in which cells convert glucose and oxygen into ATP, carbon dioxide, and water.
Glycolysis is defined as the breakdown of glucose into pyruvate occurring in the cytoplasm of the cell.
Mitochondria - The powerhouse organelle of the eukaryotic cell where the Krebs cycle and electron transport chain occur.
ATP Synthase is defined as the protein complex that synthesizes ATP using a proton gradient.
Anaerobic Respiration refers to the process of cellular energy production without the presence of oxygen.

Core Concepts:
During aerobic respiration, each glucose molecule yields approximately 30 to 32 ATP molecules because oxidative phosphorylation is highly efficient.
The citric acid cycle produces electron carriers including NADH and FADH2 which feed electrons directly into the electron transport chain.
Lactic acid fermentation occurs in human muscle cells when oxygen levels are insufficient to support aerobic cellular respiration.
Electron transport chain results in the creation of a proton gradient across the inner mitochondrial membrane.
`;

    it("generates exactly 20 educational flashcards without gobbledygook", () => {
      const cards = generate20Flashcards(sampleMaterial, "Cellular Respiration", "Biology");
      expect(cards.length).toBe(20);

      // Verify each card has meaningful question, answer, and topic
      for (const card of cards) {
        expect(card.q.length).toBeGreaterThan(5);
        expect(card.a.length).toBeGreaterThan(5);
        expect(card.t.length).toBeGreaterThan(0);
        // Ensure no raw undefined or null strings
        expect(card.q).not.toContain("undefined");
        expect(card.a).not.toContain("undefined");
      }

      // Verify key definitions are extracted
      const hasDefCard = cards.some(
        (c) => c.q.includes("Cellular Respiration") || c.q.includes("Glycolysis")
      );
      expect(hasDefCard).toBe(true);
    });

    it("generates structured markdown notes covering all class material, sections, and definitions", () => {
      const notes = generateNotesFromMaterial(sampleMaterial, "Cellular Respiration", "Biology");
      expect(notes).toContain("# Cellular Respiration");
      expect(notes).toContain("## Overview & Foundations");
      expect(notes).toContain("## Key Terminology & Definitions");
      expect(notes).toContain("## Core Concepts");
      expect(notes).toContain("## Comprehensive Class Review & Synthesis");
      expect(notes).toContain("## Key Takeaways");
      // Must cover key terms from the document
      expect(notes).toContain("Mitochondria");
      expect(notes).toContain("ATP Synthase");
      expect(notes).toContain("Anaerobic Respiration");
    });
  });

  describe("Spaced Repetition (SM-2 Algorithm)", () => {
    it("schedules card reviews with appropriate intervals for Again, Hard, Good, and Easy", () => {
      const baseCard = {
        interval_days: 0,
        reps: 0,
        lapses: 0,
        ease_factor: 2.5,
      };

      // 1. "Again" resets interval and marks learning
      const againResult = schedule(baseCard, "again");
      expect(againResult.interval_days).toBe(0);
      expect(againResult.status).toBe("learning");
      expect(againResult.lapses).toBe(1);

      // 2. "Hard" gives 1 day initially
      const hardResult = schedule(baseCard, "hard");
      expect(hardResult.interval_days).toBe(1);
      expect(hardResult.status).toBe("learning");
      expect(hardResult.reps).toBe(1);

      // 3. "Good" / "Know" gives 1 day, then 6 days, then grows with ease factor
      const good1 = schedule(baseCard, "good");
      expect(good1.interval_days).toBe(1);
      expect(good1.reps).toBe(1);

      const good2 = schedule({ ...baseCard, interval_days: 1, reps: 1 }, "good");
      expect(good2.interval_days).toBe(6);
      expect(good2.status).toBe("known");

      // 4. "Easy" boosts interval significantly
      const easy1 = schedule(baseCard, "easy");
      expect(easy1.interval_days).toBe(4);
      expect(easy1.status).toBe("known");
      expect(easy1.ease_factor).toBeGreaterThan(2.5);
    });
  });

  describe("RPG Levels Rank Mapping", () => {
    it("maps percentage scores across RPG tiers accurately", () => {
      const novice = RPG_RANKS.find((r) => 10 >= r.minPct && 10 <= r.maxPct);
      expect(novice?.title).toBe("Novice");

      const scholar = RPG_RANKS.find((r) => 65 >= r.minPct && 65 <= r.maxPct);
      expect(scholar?.title).toBe("Scholar");

      const master = RPG_RANKS.find((r) => 95 >= r.minPct && 95 <= r.maxPct);
      expect(master?.title).toBe("Grandmaster");
    });
  });

  describe("Daily Streak Counter", () => {
    it("increments study streak when a study session is completed", () => {
      const initial = getStreakData();
      expect(initial.currentStreak).toBeGreaterThanOrEqual(1);

      const updated = recordStudySessionCompletion(20, "20 Flashcards Review");
      expect(updated.totalSessionsCompleted).toBeGreaterThanOrEqual(1);
      expect(updated.currentStreak).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Daily Study Goals", () => {
    it("allows creating and updating daily study goals", () => {
      const newGoal: StudyGoal = {
        id: "goal_test_1",
        topic: "Master 20 Biology Flashcards",
        chapter: "Chapter 3",
        targetMinutes: 20,
        completed: false,
        createdAt: new Date().toISOString(),
      };

      saveDailyGoals([newGoal]);
      const stored = getDailyGoals();
      expect(stored.length).toBe(1);
      expect(stored[0]?.topic).toBe("Master 20 Biology Flashcards");
      expect(stored[0]?.completed).toBe(false);

      // Toggle to completed
      stored[0]!.completed = true;
      saveDailyGoals(stored);

      const after = getDailyGoals();
      expect(after[0]?.completed).toBe(true);
    });
  });

  describe("Session History", () => {
    it("records and retrieves completed study sessions with timestamps and durations", () => {
      addSessionRecord({
        timestamp: new Date().toISOString(),
        duration: "25m",
        topic: "Cellular Respiration Flashcards",
        type: "Flashcards",
      });

      const history = getSessionHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]?.topic).toBe("Cellular Respiration Flashcards");
      expect(history[0]?.duration).toBe("25m");
      expect(history[0]?.timestamp).toBeDefined();
    });
  });
});
