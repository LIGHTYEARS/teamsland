import { randomUUID } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import { CliProcess, type CliProcessOpts, type ResultEvent } from "@teamsland/sidecar";
import type {
  CoordinatorContext,
  CoordinatorContextLoader,
  CoordinatorEvent,
  CoordinatorState,
} from "@teamsland/types";
import type { PipelineTracker } from "./pipeline-tracker.js";

const logger = createLogger("server:coordinator-process");

export interface CoordinatorPromptBuilderLike {
  build(event: CoordinatorEvent, context: CoordinatorContext): string;
}

export interface CoordinatorProcessConfig {
  workspacePath: string;
  systemPromptPath: string;
  allowedTools: string[];
  sessionMaxLifetimeMs: number;
  maxEventsPerSession: number;
  resultTimeoutMs: number;
}

export interface CoordinatorProcessOpts {
  config: CoordinatorProcessConfig;
  contextLoader: CoordinatorContextLoader;
  promptBuilder: CoordinatorPromptBuilderLike;
  spawnFn?: CliProcessOpts["spawnFn"];
}

export class CoordinatorProcess {
  private cli: CliProcess | null = null;
  private sessionId: string | null = null;
  private eventCount = 0;
  private startedAt = 0;
  private state: CoordinatorState = "idle";
  private stateChangeCallback: ((state: CoordinatorState, eventId?: string) => void) | null = null;

  private readonly config: CoordinatorProcessConfig;
  private readonly contextLoader: CoordinatorContextLoader;
  private readonly promptBuilder: CoordinatorPromptBuilderLike;
  private readonly spawnFn?: CliProcessOpts["spawnFn"];

  constructor(opts: CoordinatorProcessOpts) {
    this.config = opts.config;
    this.contextLoader = opts.contextLoader;
    this.promptBuilder = opts.promptBuilder;
    this.spawnFn = opts.spawnFn;
  }

  async processEvent(event: CoordinatorEvent, tracker?: PipelineTracker): Promise<ResultEvent> {
    const cli = await this.ensureProcess();

    this.setState("running", event.id);

    tracker?.phase("contextLoad");
    const context = await this.contextLoader.load(event, tracker);
    tracker?.endPhase();

    tracker?.phase("promptBuild");
    const prompt = this.promptBuilder.build(event, context);
    tracker?.endPhase();

    try {
      tracker?.phase("inference");
      const result = await cli.sendMessage(prompt);
      tracker?.endPhase();
      this.eventCount++;
      this.setState("idle", event.id);

      tracker?.setInferenceResult({
        durationMs: result.duration_ms,
        numTurns: result.num_turns,
        costUsd: result.total_cost_usd,
      });
      if (tracker && this.sessionId) {
        tracker.setSessionInfo(this.sessionId, this.eventCount);
      }

      logger.debug(
        {
          eventId: event.id,
          eventType: event.type,
          promptLength: prompt.length,
          promptPreview: prompt.slice(0, 500),
          resultText: result.result?.slice(0, 1000),
          numTurns: result.num_turns,
          costUsd: result.total_cost_usd,
          sessionId: this.sessionId,
        },
        "Coordinator 决策审计",
      );

      if (this.shouldRotateSession()) {
        await this.rotateSession();
      }

      return result;
    } catch (err) {
      tracker?.endPhase();
      logger.error({ err, eventId: event.id }, "processEvent 失败");
      this.setState("failed", event.id);
      this.cli = null;
      throw err;
    }
  }

  getState(): CoordinatorState {
    return this.state;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  onStateChange(callback: (state: CoordinatorState, eventId?: string) => void): void {
    this.stateChangeCallback = callback;
  }

  async reset(): Promise<void> {
    if (this.cli) {
      await this.cli.terminate();
      this.cli = null;
    }
    this.sessionId = null;
    this.eventCount = 0;
    this.setState("idle");
  }

  private async ensureProcess(): Promise<CliProcess> {
    if (this.cli?.isAlive()) return this.cli;

    const shouldResume = this.sessionId && !this.isSessionExpired();

    const newSessionId = shouldResume ? null : randomUUID();
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    const args = [
      "--bare",
      "--append-system-prompt-file",
      this.config.systemPromptPath,
      "--allowedTools",
      this.config.allowedTools.join(","),
      "--dangerously-skip-permissions",
    ];

    const sid = this.sessionId as string;

    this.cli = new CliProcess({
      sessionId: sid,
      args,
      cwd: this.config.workspacePath,
      spawnFn: this.spawnFn,
      resultTimeoutMs: this.config.resultTimeoutMs,
      resumeSessionId: shouldResume ? sid : undefined,
    });

    this.setState("spawning");
    await this.cli.start();

    if (newSessionId) {
      this.startedAt = Date.now();
      this.eventCount = 0;
    }

    this.cli.onExit((code) => {
      logger.info({ code, sessionId: this.sessionId }, "Coordinator CLI 进程退出");
    });

    return this.cli;
  }

  private shouldRotateSession(): boolean {
    if (this.eventCount >= this.config.maxEventsPerSession) return true;
    if (Date.now() - this.startedAt > this.config.sessionMaxLifetimeMs) return true;
    return false;
  }

  private async rotateSession(): Promise<void> {
    logger.info(
      {
        sessionId: this.sessionId,
        eventCount: this.eventCount,
        sessionAgeMs: Date.now() - this.startedAt,
        reason: this.eventCount >= this.config.maxEventsPerSession ? "maxEvents" : "maxLifetime",
      },
      "Session 轮转",
    );
    if (this.cli) {
      await this.cli.terminate();
      this.cli = null;
    }
    this.sessionId = null;
    this.eventCount = 0;
    this.startedAt = 0;
  }

  private isSessionExpired(): boolean {
    if (!this.startedAt) return true;
    return Date.now() - this.startedAt > this.config.sessionMaxLifetimeMs;
  }

  private setState(newState: CoordinatorState, eventId?: string): void {
    if (this.state !== newState) {
      this.state = newState;
      this.stateChangeCallback?.(newState, eventId);
    }
  }
}
