import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendEvolutionLog, readEvolutionLog } from "../evolution-log.js";

describe("Evolution Log", () => {
  const testDir = join(tmpdir(), `evo-test-${randomUUID().slice(0, 8)}`);

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  it("should append and read entries", async () => {
    mkdirSync(testDir, { recursive: true });

    await appendEvolutionLog(testDir, {
      timestamp: "2026-04-23T10:00:00Z",
      action: "create_hook",
      path: "hooks/meego/issue-assigned.ts",
      reason: "处理了 5 次相同的 issue.assigned",
      patternCount: 5,
    });

    await appendEvolutionLog(testDir, {
      timestamp: "2026-04-23T11:00:00Z",
      action: "approve_hook",
      path: "hooks/meego/issue-assigned.ts",
      reason: "管理员审批通过",
      approvedBy: "admin",
    });

    const entries = await readEvolutionLog(testDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe("create_hook");
    expect(entries[1].action).toBe("approve_hook");
  });

  it("should return empty array when log file does not exist", async () => {
    mkdirSync(testDir, { recursive: true });
    const entries = await readEvolutionLog(testDir);
    expect(entries).toEqual([]);
  });

  it("should handle limit and offset", async () => {
    mkdirSync(testDir, { recursive: true });

    for (let i = 0; i < 5; i++) {
      await appendEvolutionLog(testDir, {
        timestamp: `2026-04-23T${10 + i}:00:00Z`,
        action: "create_hook",
        path: `hooks/test-${i}.ts`,
        reason: `Test ${i}`,
      });
    }

    const page = await readEvolutionLog(testDir, 2, 1);
    expect(page).toHaveLength(2);
    expect(page[0].path).toBe("hooks/test-1.ts");
    expect(page[1].path).toBe("hooks/test-2.ts");
  });
});
