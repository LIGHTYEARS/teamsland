/**
 * 记忆检索精度回归测试
 *
 * 50 篇语料文档 + 20 条标注查询，断言 P@10 >= 0.8。
 * 使用 FakeEmbedder（基于哈希的确定性向量），精度主要依赖 FTS5 trigram 匹配。
 * 每条查询标注了期望命中的文档 ID 列表（relevant set）。
 * P@10 = |retrieved ∩ relevant| / min(10, |relevant|)
 */
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryType, StorageConfig } from "@teamsland/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Embedder } from "../embedder.js";
import { retrieve } from "../retriever.js";
import { TeamMemoryStore } from "../team-memory-store.js";

// ─── sqlite-vec 可用性检测 ───

let vecAvailable = false;
try {
  const testDb = new Database(":memory:");
  testDb.loadExtension("vec0");
  testDb.close();
  vecAvailable = true;
} catch {
  vecAvailable = false;
}

// ─── FakeEmbedder ───

class FakeEmbedder implements Embedder {
  private initialized = false;

  async init(): Promise<void> {
    this.initialized = true;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.initialized) throw new Error("Embedder not initialized");
    return this.hashToVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  private hashToVector(text: string): number[] {
    const vec = new Array<number>(512);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    for (let i = 0; i < 512; i++) {
      hash = (hash * 1103515245 + 12345) | 0;
      vec[i] = ((hash >> 16) & 0x7fff) / 0x7fff;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    for (let i = 0; i < 512; i++) {
      vec[i] = vec[i] / norm;
    }
    return vec;
  }
}

// ─── 语料定义 ───

interface CorpusDoc {
  id: string;
  content: string;
  memoryType: MemoryType;
}

/** 50 篇语料文档，覆盖前端、后端、设计、测试、运维等领域 */
const CORPUS: CorpusDoc[] = [
  { id: "d01", content: "React 组件使用 hooks 管理状态，useEffect 处理副作用", memoryType: "decisions" },
  { id: "d02", content: "Vue3 采用 Composition API 重构表单逻辑", memoryType: "decisions" },
  { id: "d03", content: "TailwindCSS 替代传统 CSS 模块化方案", memoryType: "decisions" },
  { id: "d04", content: "TypeScript strict 模式强制开启，禁止 any 类型", memoryType: "decisions" },
  { id: "d05", content: "前端单元测试使用 Vitest 框架，覆盖率目标 80%", memoryType: "decisions" },
  { id: "d06", content: "Node.js 后端服务使用 Bun 运行时加速启动", memoryType: "decisions" },
  { id: "d07", content: "数据库选择 PostgreSQL 作为主存储引擎", memoryType: "decisions" },
  { id: "d08", content: "Redis 用于缓存层和会话管理", memoryType: "decisions" },
  { id: "d09", content: "API 网关使用 Nginx 反向代理和负载均衡", memoryType: "decisions" },
  { id: "d10", content: "微服务间通信采用 gRPC 替代 REST", memoryType: "decisions" },
  { id: "d11", content: "Kubernetes 集群部署，Pod 自动伸缩策略", memoryType: "patterns" },
  { id: "d12", content: "CI/CD 管线使用 GitHub Actions 自动构建和部署", memoryType: "patterns" },
  { id: "d13", content: "Docker 镜像多阶段构建优化体积", memoryType: "patterns" },
  { id: "d14", content: "Prometheus 和 Grafana 监控告警体系搭建", memoryType: "patterns" },
  { id: "d15", content: "ELK 日志收集分析平台部署方案", memoryType: "patterns" },
  { id: "d16", content: "Figma 设计稿交接流程和组件库规范", memoryType: "skills" },
  { id: "d17", content: "移动端适配使用 rem 和 viewport 单位", memoryType: "skills" },
  { id: "d18", content: "无障碍设计 WCAG 2.1 AA 标准实施", memoryType: "skills" },
  { id: "d19", content: "暗色模式和主题切换技术方案", memoryType: "skills" },
  { id: "d20", content: "国际化 i18n 多语言支持集成", memoryType: "skills" },
  { id: "d21", content: "WebSocket 实时消息推送架构设计", memoryType: "patterns" },
  { id: "d22", content: "OAuth 2.0 和 JWT 认证鉴权方案", memoryType: "decisions" },
  { id: "d23", content: "文件上传服务对接 OSS 云存储", memoryType: "patterns" },
  { id: "d24", content: "全文检索使用 Elasticsearch 分词索引", memoryType: "decisions" },
  { id: "d25", content: "数据库迁移工具 Prisma 管理 schema 变更", memoryType: "tools" },
  { id: "d26", content: "前端路由使用 React Router v6 嵌套路由", memoryType: "decisions" },
  { id: "d27", content: "状态管理从 Redux 迁移到 Zustand 轻量方案", memoryType: "decisions" },
  { id: "d28", content: "表单校验使用 Zod schema 替代手动验证", memoryType: "decisions" },
  { id: "d29", content: "GraphQL 接口层替代部分 REST 查询", memoryType: "decisions" },
  { id: "d30", content: "端到端测试使用 Playwright 模拟用户操作", memoryType: "tools" },
  { id: "d31", content: "性能优化：图片懒加载和 WebP 格式转换", memoryType: "patterns" },
  { id: "d32", content: "CDN 静态资源加速和缓存策略配置", memoryType: "patterns" },
  { id: "d33", content: "安全防护：XSS 过滤和 CSP 策略设置", memoryType: "patterns" },
  { id: "d34", content: "代码审查 Code Review 流程和 PR 规范", memoryType: "patterns" },
  { id: "d35", content: "Git 分支管理采用 trunk-based 开发模式", memoryType: "patterns" },
  { id: "d36", content: "错误追踪和异常上报使用 Sentry 平台", memoryType: "tools" },
  { id: "d37", content: "A/B 测试平台集成和实验管理", memoryType: "tools" },
  { id: "d38", content: "飞书机器人消息通知和审批流程自动化", memoryType: "skills" },
  { id: "d39", content: "定时任务调度器 cron 作业管理", memoryType: "patterns" },
  { id: "d40", content: "数据备份策略：增量备份和异地灾备", memoryType: "patterns" },
  { id: "d41", content: "团队 Sprint 迭代规划和 Meego 看板管理", memoryType: "project_context" },
  { id: "d42", content: "新员工入职技术培训和文档指南", memoryType: "project_context" },
  { id: "d43", content: "API 版本管理和向后兼容策略", memoryType: "decisions" },
  { id: "d44", content: "服务降级和熔断器 Circuit Breaker 模式", memoryType: "patterns" },
  { id: "d45", content: "分布式事务 Saga 模式实现方案", memoryType: "patterns" },
  { id: "d46", content: "消息队列 Kafka 事件驱动架构集成", memoryType: "decisions" },
  { id: "d47", content: "SSR 服务端渲染和 SEO 优化方案", memoryType: "decisions" },
  { id: "d48", content: "Monorepo 工作区管理和包依赖治理", memoryType: "patterns" },
  { id: "d49", content: "代码生成器和脚手架模板自动化工具", memoryType: "tools" },
  { id: "d50", content: "用户行为埋点和数据分析平台集成", memoryType: "skills" },
];

/** 20 条标注查询，每条指定期望命中的文档 ID 集合 */
interface LabelledQuery {
  query: string;
  relevant: string[];
}

const QUERIES: LabelledQuery[] = [
  { query: "React hooks", relevant: ["d01", "d26", "d27"] },
  { query: "TypeScript strict", relevant: ["d04"] },
  { query: "Vitest 测试", relevant: ["d05"] },
  { query: "数据库 PostgreSQL", relevant: ["d07", "d25"] },
  { query: "Kubernetes 部署", relevant: ["d11", "d13"] },
  { query: "CI/CD GitHub Actions", relevant: ["d12"] },
  { query: "Prometheus 监控", relevant: ["d14"] },
  { query: "设计稿 Figma", relevant: ["d16"] },
  { query: "国际化 i18n", relevant: ["d20"] },
  { query: "WebSocket 实时", relevant: ["d21"] },
  { query: "OAuth JWT 认证", relevant: ["d22"] },
  { query: "Elasticsearch 全文检索", relevant: ["d24"] },
  { query: "Zod schema 校验", relevant: ["d28"] },
  { query: "Playwright 端到端", relevant: ["d30"] },
  { query: "XSS 安全防护", relevant: ["d33"] },
  { query: "Git 分支管理", relevant: ["d34", "d35"] },
  { query: "Sentry 错误追踪", relevant: ["d36"] },
  { query: "飞书机器人通知", relevant: ["d38"] },
  { query: "Kafka 消息队列", relevant: ["d46"] },
  { query: "Monorepo 工作区", relevant: ["d48"] },
];

// ─── 辅助函数 ───

const TEST_CONFIG: StorageConfig = {
  sqliteVec: { dbPath: "will-be-overridden", busyTimeoutMs: 5000, vectorDimensions: 512 },
  embedding: { model: "fake", contextSize: 2048 },
  entityMerge: { cosineThreshold: 0.95 },
  fts5: { optimizeIntervalHours: 24 },
};

let tmpDir: string;
const TEAM_ID = "precision-test";

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "precision-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/**
 * 计算 Precision@K
 *
 * @param retrieved - 检索结果 ID 列表（前 K 个）
 * @param relevant - 标注相关文档 ID 集合
 * @returns 精度值 [0, 1]
 */
function precisionAtK(retrieved: string[], relevant: Set<string>): number {
  const denominator = Math.min(retrieved.length, relevant.size);
  if (denominator === 0) return 1;
  const hits = retrieved.filter((id) => relevant.has(id)).length;
  return hits / denominator;
}

// ─── 测试套件 ───

describe.skipIf(!vecAvailable)("Memory retrieval precision regression", () => {
  let store: TeamMemoryStore;
  let embedder: FakeEmbedder;

  beforeAll(async () => {
    const dbPath = join(tmpDir, `precision-${randomUUID()}.sqlite`);
    const config: StorageConfig = { ...TEST_CONFIG, sqliteVec: { ...TEST_CONFIG.sqliteVec, dbPath } };
    embedder = new FakeEmbedder();
    await embedder.init();
    store = new TeamMemoryStore(TEAM_ID, config, embedder);

    // 写入 50 篇语料
    for (const doc of CORPUS) {
      await store.writeEntry({
        id: doc.id,
        teamId: TEAM_ID,
        agentId: "corpus-loader",
        memoryType: doc.memoryType,
        content: doc.content,
        accessCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        toDict: () => ({ id: doc.id, content: doc.content }),
        toVectorPoint: () => ({ id: doc.id, vector: [], payload: { content: doc.content } }),
      });
    }
  });

  afterAll(() => {
    store.close();
  });

  // 逐条查询测试：确保每条查询至少命中一个标注文档
  for (const q of QUERIES) {
    it(`查询 "${q.query}" 应命中标注文档`, async () => {
      const results = await retrieve(store, embedder, q.query, TEAM_ID, 10);
      const resultIds = results.map((r) => r.id);
      const relevantSet = new Set(q.relevant);
      const hits = resultIds.filter((id) => relevantSet.has(id));
      expect(hits.length).toBeGreaterThan(0);
    });
  }

  // 聚合精度测试：全部 20 条查询的平均 P@10 >= 0.8
  it("全部 20 条查询的平均 P@10 >= 0.8", async () => {
    let totalPrecision = 0;
    const details: Array<{ query: string; p: number; hits: string[] }> = [];

    for (const q of QUERIES) {
      const results = await retrieve(store, embedder, q.query, TEAM_ID, 10);
      const resultIds = results.map((r) => r.id);
      const relevantSet = new Set(q.relevant);
      const p = precisionAtK(resultIds, relevantSet);
      const hits = resultIds.filter((id) => relevantSet.has(id));
      details.push({ query: q.query, p, hits });
      totalPrecision += p;
    }

    const avgPrecision = totalPrecision / QUERIES.length;

    // 输出诊断信息（测试失败时可查看）
    if (avgPrecision < 0.8) {
      for (const d of details) {
        console.log(`  query="${d.query}" P@10=${d.p.toFixed(2)} hits=[${d.hits.join(",")}]`);
      }
    }

    expect(avgPrecision).toBeGreaterThanOrEqual(0.8);
  });
});
