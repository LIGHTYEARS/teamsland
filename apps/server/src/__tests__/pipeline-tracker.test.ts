import { describe, expect, it } from "vitest";
import { PipelineTracker } from "../pipeline-tracker.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("PipelineTracker", () => {
  describe("constructor and defaults", () => {
    it("should record msgId, eventType, and default values", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      const summary = tracker.summarize();

      expect(summary.msgId).toBe("msg-1");
      expect(summary.eventType).toBe("lark_dm");
      expect(summary.phases).toEqual({});
      expect(summary.subPhases).toEqual({});
      expect(summary.inference).toBeNull();
      expect(summary.sessionId).toBeNull();
      expect(summary.sessionEventIndex).toBeNull();
      expect(summary.outcome).toBe("unknown");
    });
  });

  describe("dwellMs", () => {
    it("should compute dwellMs from enqueuedAt to summarize time", async () => {
      const enqueuedAt = Date.now() - 100; // pretend enqueued 100ms ago
      const tracker = new PipelineTracker("msg-1", "lark_dm", enqueuedAt);
      const summary = tracker.summarize();

      expect(summary.dwellMs).toBeGreaterThanOrEqual(95);
    });
  });

  describe("totalMs", () => {
    it("should compute totalMs from construction to summarize", async () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      await sleep(15);
      const summary = tracker.summarize();

      expect(summary.totalMs).toBeGreaterThanOrEqual(12);
    });
  });

  describe("phase tracking", () => {
    it("should record a single phase duration", async () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.phase("context");
      await sleep(15);
      tracker.endPhase();

      const summary = tracker.summarize();
      expect(summary.phases.context).toBeGreaterThanOrEqual(12);
    });

    it("should record multiple phases", async () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());

      tracker.phase("context");
      await sleep(15);
      tracker.endPhase();

      tracker.phase("inference");
      await sleep(15);
      tracker.endPhase();

      const summary = tracker.summarize();
      expect(summary.phases.context).toBeGreaterThanOrEqual(12);
      expect(summary.phases.inference).toBeGreaterThanOrEqual(12);
    });

    it("should auto-close current phase when starting a new one", async () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());

      tracker.phase("context");
      await sleep(15);
      tracker.phase("inference"); // should auto-close "context"
      tracker.endPhase();

      const summary = tracker.summarize();
      expect(summary.phases.context).toBeGreaterThanOrEqual(12);
      expect(summary.phases.inference).toBeDefined();
    });

    it("should auto-close current phase on summarize", async () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());

      tracker.phase("context");
      await sleep(15);
      // do NOT call endPhase — summarize should close it

      const summary = tracker.summarize();
      expect(summary.phases.context).toBeGreaterThanOrEqual(12);
    });

    it("should be a no-op to call endPhase when no phase is active", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.endPhase(); // should not throw
      const summary = tracker.summarize();
      expect(summary.phases).toEqual({});
    });
  });

  describe("sub-phase tracking", () => {
    it("should record sub-phases under a parent", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.subPhase("context", "memory_fetch", 42);
      tracker.subPhase("context", "ticket_fetch", 18);

      const summary = tracker.summarize();
      expect(summary.subPhases.context).toEqual({
        memory_fetch: 42,
        ticket_fetch: 18,
      });
    });

    it("should record sub-phases under multiple parents", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.subPhase("context", "memory_fetch", 42);
      tracker.subPhase("inference", "tool_call_1", 200);

      const summary = tracker.summarize();
      expect(summary.subPhases.context).toEqual({ memory_fetch: 42 });
      expect(summary.subPhases.inference).toEqual({ tool_call_1: 200 });
    });
  });

  describe("inference result", () => {
    it("should record full inference result", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.setInferenceResult({ durationMs: 1500, numTurns: 3, costUsd: 0.05 });

      const summary = tracker.summarize();
      expect(summary.inference).toEqual({ durationMs: 1500, numTurns: 3, costUsd: 0.05 });
    });

    it("should default missing inference fields to 0", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.setInferenceResult({ durationMs: 800 });

      const summary = tracker.summarize();
      expect(summary.inference).toEqual({ durationMs: 800, numTurns: 0, costUsd: 0 });
    });

    it("should default all inference fields to 0 when given empty object", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.setInferenceResult({});

      const summary = tracker.summarize();
      expect(summary.inference).toEqual({ durationMs: 0, numTurns: 0, costUsd: 0 });
    });
  });

  describe("session info", () => {
    it("should record session id and event index", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.setSessionInfo("sess-abc", 5);

      const summary = tracker.summarize();
      expect(summary.sessionId).toBe("sess-abc");
      expect(summary.sessionEventIndex).toBe(5);
    });
  });

  describe("outcome", () => {
    it("should record success outcome", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.setOutcome("success");

      const summary = tracker.summarize();
      expect(summary.outcome).toBe("success");
    });

    it("should record failed outcome", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.setOutcome("failed");

      const summary = tracker.summarize();
      expect(summary.outcome).toBe("failed");
    });

    it("should record timeout outcome", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.setOutcome("timeout");

      const summary = tracker.summarize();
      expect(summary.outcome).toBe("timeout");
    });
  });

  describe("summarize returns copies", () => {
    it("should return independent copies of phases and subPhases", () => {
      const tracker = new PipelineTracker("msg-1", "lark_dm", Date.now());
      tracker.phase("context");
      tracker.endPhase();
      tracker.subPhase("context", "memory_fetch", 42);

      const summary1 = tracker.summarize();
      summary1.phases.context = 9999;
      summary1.subPhases.context.memory_fetch = 9999;

      const summary2 = tracker.summarize();
      expect(summary2.phases.context).not.toBe(9999);
      expect(summary2.subPhases.context.memory_fetch).toBe(42);
    });
  });
});
