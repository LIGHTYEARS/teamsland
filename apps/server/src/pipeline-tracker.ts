import { performance } from "node:perf_hooks";

export interface PipelineSummary {
  msgId: string;
  eventType: string;
  dwellMs: number;
  phases: Record<string, number>;
  subPhases: Record<string, Record<string, number>>;
  inference: { durationMs: number; numTurns: number; costUsd: number } | null;
  sessionId: string | null;
  sessionEventIndex: number | null;
  totalMs: number;
  outcome: string;
}

export class PipelineTracker {
  private readonly msgId: string;
  private readonly eventType: string;
  private readonly enqueuedAt: number;
  private readonly startedAt: number;

  private currentPhase: string | null = null;
  private currentPhaseStart = 0;
  private readonly phases: Record<string, number> = {};
  private readonly subPhasesMap: Record<string, Record<string, number>> = {};

  private inferenceResult: { durationMs: number; numTurns: number; costUsd: number } | null = null;
  private sessionId: string | null = null;
  private sessionEventIndex: number | null = null;
  private outcome = "unknown";

  constructor(msgId: string, eventType: string, enqueuedAt: number) {
    this.msgId = msgId;
    this.eventType = eventType;
    this.enqueuedAt = enqueuedAt;
    this.startedAt = performance.now();
  }

  phase(name: string): void {
    if (this.currentPhase) {
      this.endPhase();
    }
    this.currentPhase = name;
    this.currentPhaseStart = performance.now();
  }

  endPhase(): void {
    if (this.currentPhase) {
      this.phases[this.currentPhase] = Math.round(performance.now() - this.currentPhaseStart);
      this.currentPhase = null;
    }
  }

  subPhase(parent: string, name: string, durationMs: number): void {
    if (!this.subPhasesMap[parent]) {
      this.subPhasesMap[parent] = {};
    }
    this.subPhasesMap[parent][name] = durationMs;
  }

  setInferenceResult(result: { durationMs?: number; numTurns?: number; costUsd?: number }): void {
    this.inferenceResult = {
      durationMs: result.durationMs ?? 0,
      numTurns: result.numTurns ?? 0,
      costUsd: result.costUsd ?? 0,
    };
  }

  setSessionInfo(sessionId: string, eventIndex: number): void {
    this.sessionId = sessionId;
    this.sessionEventIndex = eventIndex;
  }

  setOutcome(outcome: "success" | "failed" | "timeout"): void {
    this.outcome = outcome;
  }

  summarize(): PipelineSummary {
    if (this.currentPhase) {
      this.endPhase();
    }
    return {
      msgId: this.msgId,
      eventType: this.eventType,
      dwellMs: Math.round(Date.now() - this.enqueuedAt),
      phases: { ...this.phases },
      subPhases: Object.fromEntries(Object.entries(this.subPhasesMap).map(([k, v]) => [k, { ...v }])),
      inference: this.inferenceResult,
      sessionId: this.sessionId,
      sessionEventIndex: this.sessionEventIndex,
      totalMs: Math.round(performance.now() - this.startedAt),
      outcome: this.outcome,
    };
  }
}
