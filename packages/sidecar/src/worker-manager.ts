import { randomUUID } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import type { AgentOrigin, AgentRecord } from "@teamsland/types";
import { CliProcess, type CliProcessOpts, type ResultEvent } from "./cli-process.js";
import type { SubagentRegistry } from "./registry.js";

const logger = createLogger("sidecar:worker-manager");

export interface WorkerManagerOpts {
  registry: SubagentRegistry;
  queue: {
    enqueue(opts: { type: string; payload: Record<string, unknown>; priority: string; traceId: string }): string;
  };
  notifier: {
    sendDm(userId: string, text: string): Promise<void>;
    sendCard(title: string, content: string, level?: string): Promise<void>;
  };
  spawnFn?: CliProcessOpts["spawnFn"];
  workerSystemPromptPath: string;
  defaultAllowedTools: string[];
  maxBudgetPerWorker?: number;
}

export interface SpawnWorkerParams {
  prompt: string;
  issueId: string;
  projectKey: string;
  origin: AgentOrigin;
  allowedTools?: string[];
  worktreeName?: string;
  maxBudgetUsd?: number;
}

export interface WorkerEvent {
  type: "completed" | "failed";
  workerId: string;
  issueId: string;
  result?: string;
  exitCode?: number | null;
  origin: AgentOrigin;
}

export class WorkerManager {
  private readonly registry: WorkerManagerOpts["registry"];
  private readonly queue: WorkerManagerOpts["queue"];
  private readonly notifier: WorkerManagerOpts["notifier"];
  private readonly spawnFn: CliProcessOpts["spawnFn"];
  private readonly workerSystemPromptPath: string;
  private readonly defaultAllowedTools: string[];
  private readonly maxBudgetPerWorker: number;

  private readonly activeProcesses = new Map<string, CliProcess>();
  private workerEventCallback: ((event: WorkerEvent) => void) | null = null;

  constructor(opts: WorkerManagerOpts) {
    this.registry = opts.registry;
    this.queue = opts.queue;
    this.notifier = opts.notifier;
    this.spawnFn = opts.spawnFn;
    this.workerSystemPromptPath = opts.workerSystemPromptPath;
    this.defaultAllowedTools = opts.defaultAllowedTools;
    this.maxBudgetPerWorker = opts.maxBudgetPerWorker ?? 2.0;
  }

  onWorkerEvent(callback: (event: WorkerEvent) => void): void {
    this.workerEventCallback = callback;
  }

  async spawnWorker(params: SpawnWorkerParams): Promise<string> {
    const workerId = randomUUID();
    const tools = params.allowedTools ?? this.defaultAllowedTools;

    const record: AgentRecord = {
      agentId: workerId,
      pid: 0,
      sessionId: workerId,
      issueId: params.issueId,
      worktreePath: "",
      status: "running",
      retryCount: 0,
      createdAt: Date.now(),
      origin: params.origin,
      taskPrompt: params.prompt.slice(0, 500),
    };
    this.registry.register(record);

    const cliArgs = [
      "--bare",
      "--append-system-prompt-file",
      this.workerSystemPromptPath,
      "--allowedTools",
      tools.join(","),
      "--dangerously-skip-permissions",
    ];

    if (params.maxBudgetUsd ?? this.maxBudgetPerWorker) {
      cliArgs.push("--max-budget-usd", String(params.maxBudgetUsd ?? this.maxBudgetPerWorker));
    }
    if (params.worktreeName) {
      cliArgs.push("--worktree", params.worktreeName);
    }

    const cli = new CliProcess({
      sessionId: workerId,
      args: cliArgs,
      spawnFn: this.spawnFn,
    });

    this.activeProcesses.set(workerId, cli);
    await cli.start();

    let resultReceived = false;

    cli.onExit((code) => {
      if (!resultReceived) {
        this.handleWorkerFailed(workerId, code);
      }
      this.activeProcesses.delete(workerId);
    });

    cli.sendMessage(params.prompt).then(
      (result) => {
        resultReceived = true;
        this.handleWorkerCompleted(workerId, result);
      },
      (err) => {
        logger.error({ err, workerId }, "Worker sendMessage 失败");
      },
    );

    return workerId;
  }

  async sendToWorker(workerId: string, message: string): Promise<ResultEvent> {
    const cli = this.activeProcesses.get(workerId);
    if (!cli?.isAlive()) {
      throw new Error(`Worker ${workerId} is not alive`);
    }
    return cli.sendMessage(message);
  }

  private handleWorkerCompleted(workerId: string, resultEvent: ResultEvent): void {
    const record = this.registry.get(workerId);
    if (!record?.origin) return;

    const event: WorkerEvent = {
      type: "completed",
      workerId,
      issueId: record.issueId,
      result: resultEvent.result,
      origin: record.origin,
    };
    this.workerEventCallback?.(event);

    this.queue.enqueue({
      type: "worker_completed",
      payload: {
        workerId: record.agentId,
        sessionId: record.sessionId,
        issueId: record.issueId,
        resultSummary: resultEvent.result,
        chatId: record.origin?.chatId,
        senderId: record.origin?.senderId,
        senderName: record.origin?.senderName,
      },
      priority: "normal",
      traceId: `worker-${workerId}-completed`,
    });

    this.registry.unregister(workerId);
  }

  private async handleWorkerFailed(workerId: string, exitCode: number | null): Promise<void> {
    const record = this.registry.get(workerId);
    if (!record?.origin) return;

    const event: WorkerEvent = {
      type: "failed",
      workerId,
      issueId: record.issueId,
      exitCode,
      origin: record.origin,
    };
    this.workerEventCallback?.(event);

    if (record.origin?.senderId) {
      try {
        await this.notifier.sendDm(
          record.origin.senderId,
          `⚠️ 任务 ${record.issueId} 处理失败 (exit code: ${exitCode})。团队已收到通知。`,
        );
      } catch (err) {
        logger.warn({ err, workerId }, "通知用户失败");
      }
    }

    try {
      await this.notifier.sendCard(
        "Worker 异常退出",
        `Worker ${workerId} (任务: ${record.issueId}) 以 exit code ${exitCode} 退出`,
        "error",
      );
    } catch (err) {
      logger.warn({ err, workerId }, "通知团队频道失败");
    }

    this.queue.enqueue({
      type: "worker_anomaly",
      payload: {
        workerId: record.agentId,
        anomalyType: "unexpected_exit",
        details: `exit code: ${exitCode}`,
        chatId: record.origin?.chatId,
        senderId: record.origin?.senderId,
      },
      priority: "high",
      traceId: `worker-${workerId}-failed`,
    });

    this.registry.unregister(workerId);
  }

  async terminateAll(): Promise<void> {
    const promises = [...this.activeProcesses.values()].map((cli) => cli.terminate());
    await Promise.allSettled(promises);
    this.activeProcesses.clear();
  }
}
