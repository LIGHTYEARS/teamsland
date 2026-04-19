# @teamsland/observability — 结构化日志设计

> 日期：2026-04-20
> 状态：已批准
> 依赖：`pino`（运行时），`pino-pretty`（devDependencies）
> 范围：仅 Logger 部分。ObservableMessageBus / Alerter 待依赖包就绪后独立设计。

## 概述

`@teamsland/observability` 提供结构化日志 API，基于 pino 封装。所有 monorepo 包通过 `createLogger(name)` 获取带名称的 logger 实例，输出 NDJSON 到 stdout。禁止裸 `console.log`。

## 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 底层库 | pino | 成熟高性能 NDJSON logger，Bun 兼容，支持 child logger |
| API 形态 | `createLogger(name): Logger` | 返回 pino 实例，类型为 `pino.Logger`，无额外抽象层 |
| 默认日志级别 | `LOG_LEVEL` 环境变量，默认 `info` | 生产 info，开发可设 debug/trace |
| 输出格式 | NDJSON stdout | 标准化，可被管道工具（jq、Datadog Agent 等）消费 |
| 开发美化 | `LOG_PRETTY=true` 时使用 `pino-pretty` transport | 开发时可读，生产环境不加载 |
| 类型导出 | `Logger` 类型别名导出 | 下游包声明参数类型时使用 `import type { Logger }` |

## 文件结构

```
packages/observability/src/
├── index.ts          # barrel 导出
└── logger.ts         # createLogger() 工厂函数 + Logger 类型
```

## API

### `createLogger(name: string): Logger`

```typescript
import { createLogger } from "@teamsland/observability";

const logger = createLogger("config");

// 纯消息
logger.info("配置加载完成");

// 结构化字段 + 消息
logger.info({ path: "config/config.json", keys: 10 }, "配置加载完成");

// 错误日志（pino 自动序列化 Error 对象）
logger.error({ err }, "配置加载失败");

// child logger — 附加固定上下文
const child = logger.child({ requestId: "req-123" });
child.info("处理请求");
// 输出: {"level":30,"time":...,"name":"config","requestId":"req-123","msg":"处理请求"}
```

**行为：**
1. 调用 `pino({ name, level })` 创建实例
2. `level` 取 `process.env.LOG_LEVEL`，默认 `"info"`
3. 当 `process.env.LOG_PRETTY === "true"` 时，使用 `pino-pretty` transport（开发模式）

### `Logger` 类型

```typescript
import type { Logger } from "@teamsland/observability";

// 下游包声明依赖
function initService(logger: Logger): void {
  logger.info("服务启动");
}
```

`Logger` 是 `pino.Logger` 的类型别名，方便下游 `import type` 使用，避免直接依赖 pino 包。

## 实现细节

### logger.ts

```typescript
import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(name: string): Logger {
  const level = process.env.LOG_LEVEL ?? "info";

  if (process.env.LOG_PRETTY === "true") {
    return pino({
      name,
      level,
      transport: { target: "pino-pretty" },
    });
  }

  return pino({ name, level });
}
```

### index.ts

```typescript
export { createLogger } from "./logger.js";
export type { Logger } from "./logger.js";
```

## 依赖变更

`packages/observability/package.json` 需要：
- 添加 `pino` 到 `dependencies`
- 添加 `pino-pretty` 到 `devDependencies`
- 移除 `@teamsland/lark`（Alerter 延后，当前不需要）

## 测试

使用 Vitest，测试文件：`packages/observability/src/__tests__/logger.test.ts`

### 测试用例

- `createLogger` 返回带正确 name 的 logger 实例
- `createLogger` 返回的 logger 具有标准日志方法（info/error/warn/debug）
- `LOG_LEVEL` 环境变量控制日志级别（设为 `silent` 可静默）
- child logger 继承 name
- 不测试 pino 内部行为（NDJSON 格式化、序列化等是 pino 的职责）

## 验证标准

- `bunx tsc --noEmit --project packages/observability/tsconfig.json` 零错误
- `bunx biome check packages/observability/src/` 零错误
- `bun test packages/observability/` 全部通过
- 导出的函数/类型有中文 JSDoc + `@example`
- 无 `any`、无 `!` 非空断言
