# @teamsland/lark — LarkCli + LarkNotifier 设计

> 日期：2026-04-20
> 状态：已批准
> 依赖：`Bun.spawn`（运行时），`@teamsland/types`（类型）
> 范围：完整 lark-cli TypeScript wrapper + LarkNotifier（Feishu 互动卡片通知）
> 外部要求：系统需安装 `lark-cli` 二进制（飞书官方 CLI 工具）

## 概述

`@teamsland/lark` 封装飞书官方 CLI 工具 `lark-cli`，提供类型安全的 TypeScript API 用于消息发送、文档操作和联系人搜索。`LarkNotifier` 基于 `LarkCli` 提供频道卡片通知能力，供 Alerter 和其他通知场景使用。

## 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 调用方式 | 注入 `CommandRunner`，默认 `Bun.spawn` | 与 @teamsland/git 共用接口，可测试性 |
| API 形态 | 全部 async | `Bun.spawn` 返回 Promise，通知场景不应阻塞事件循环 |
| 认证 | 环境变量 `LARK_APP_ID` + `LARK_APP_SECRET` | lark-cli 从环境变量读取凭证 |
| 卡片消息 | `sendInteractiveCard(chatId, card)` 独立方法 | 区分纯文本和互动卡片，Alerter 用卡片 |
| 回复语义 | `sendGroupMessage` 支持 `replyToMessageId?` | Bot @mention 场景需要回复特定消息 |
| 错误处理 | `LarkCliError` 包含 command + exitCode + stderr | 明确失败原因，区分 CLI 不存在 vs 业务错误 |

## 文件结构

```
packages/lark/src/
├── index.ts              # barrel 导出
├── lark-cli.ts           # LarkCli 类
├── notifier.ts           # LarkNotifier 类
├── types.ts              # 本包 DTO 类型（LarkMessage, LarkContact, LarkGroup, LarkCard）
├── command-runner.ts     # CommandRunner 接口（与 @teamsland/git 相同接口）
└── __tests__/
    ├── lark-cli.test.ts
    └── notifier.test.ts
```

> 注：`CommandRunner` 接口与 `@teamsland/git` 完全相同。当两个包都实现完成后，可考虑提取到共享 utils 包。当前阶段各自定义，避免过早抽象。

## 依赖

- 运行时：无 npm 依赖（`Bun.spawn` 内建）
- Workspace：`@teamsland/types`（`LarkConfig`, `LarkBotConfig`, `LarkNotificationConfig`）
- 外部工具：`lark-cli` 二进制（需系统预装）

## 类型定义

### CommandRunner 接口（本包内定义）

```typescript
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<CommandResult>;
}
```

与 `@teamsland/git` 的 `CommandRunner` 相同签名，增加 `env` 选项用于传递认证环境变量。

### DTO 类型（本包 types.ts）

```typescript
/** 飞书消息 */
export interface LarkMessage {
  messageId: string;
  sender: string;
  content: string;
  timestamp: number;
}

/** 飞书联系人 */
export interface LarkContact {
  userId: string;
  name: string;
  department: string;
}

/** 飞书群组 */
export interface LarkGroup {
  chatId: string;
  name: string;
  description: string;
}

/** 飞书互动卡片内容 */
export interface LarkCard {
  title: string;
  content: string;
  level: "info" | "warning" | "error";
}
```

### LarkCliError

```typescript
export class LarkCliError extends Error {
  constructor(
    message: string,
    public readonly command: string[],
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    super(message);
    this.name = "LarkCliError";
  }
}
```

## API

### LarkCli 类

```typescript
import type { LarkConfig } from "@teamsland/types";

class LarkCli {
  constructor(config: LarkConfig, runner?: CommandRunner)
}
```

**构造行为：**
1. 存储 `config.appId` 和 `config.appSecret`
2. 构建 env 对象 `{ LARK_APP_ID: config.appId, LARK_APP_SECRET: config.appSecret }`
3. 所有 CLI 调用时传入此 env

**认证说明：**
`lark-cli` 从环境变量 `LARK_APP_ID` 和 `LARK_APP_SECRET` 读取应用凭证。构造 `LarkCli` 时传入 `LarkConfig`，内部在每次 `spawnSync` 调用时注入这两个环境变量。

### 消息 API

```typescript
/** 发送私聊消息 */
async sendDm(userId: string, text: string): Promise<void>

/** 发送群组文本消息 */
async sendGroupMessage(chatId: string, content: string, opts?: {
  replyToMessageId?: string;
}): Promise<void>

/** 发送群组互动卡片 */
async sendInteractiveCard(chatId: string, card: LarkCard): Promise<void>

/** 读取聊天历史消息 */
async imHistory(chatId: string, count?: number): Promise<LarkMessage[]>
```

**CLI 命令映射：**
- `sendDm` → `lark-cli im send-message --chat-type p2p --receiver-id {userId} --content {text}`
- `sendGroupMessage` → `lark-cli im send-message --chat-id {chatId} --content {content} [--reply-to {messageId}]`
- `sendInteractiveCard` → `lark-cli im send-message --chat-id {chatId} --msg-type interactive --content {JSON}`
- `imHistory` → `lark-cli im history --chat-id {chatId} --count {count}`（默认 count 取 `config.bot.historyContextCount`）

### 文档 API

```typescript
/** 读取飞书文档内容 */
async docRead(url: string): Promise<string>

/** 创建飞书文档，返回文档 URL */
async docCreate(title: string, content: string): Promise<string>
```

**CLI 命令映射：**
- `docRead` → `lark-cli doc read {url}`（stdout 为文档内容）
- `docCreate` → `lark-cli doc create --title {title} --content {content}`（stdout 含 URL）

### 搜索 API

```typescript
/** 搜索联系人 */
async contactSearch(query: string, limit?: number): Promise<LarkContact[]>

/** 搜索群组 */
async groupSearch(query: string, limit?: number): Promise<LarkGroup[]>

/** 列出已加入的群组 */
async groupListJoined(filter?: string): Promise<LarkGroup[]>
```

**CLI 命令映射：**
- `contactSearch` → `lark-cli contact search --query {query} --limit {limit}`
- `groupSearch` → `lark-cli im group search --query {query} --limit {limit}`
- `groupListJoined` → `lark-cli im group list-joined [--filter {filter}]`

**stdout 解析：** 所有搜索/列表命令假设 `lark-cli` 输出 JSON（数组）到 stdout。使用 `JSON.parse(stdout)` 解析并映射到对应 DTO 类型。

### LarkNotifier 类

```typescript
import type { LarkNotificationConfig } from "@teamsland/types";

class LarkNotifier {
  constructor(cli: LarkCli, notificationConfig: LarkNotificationConfig)

  async sendCard(title: string, content: string, level?: "info" | "warning" | "error"): Promise<void>
}
```

**构造行为：**
- 存储 `cli` 实例和 `notificationConfig.teamChannelId`

**`sendCard` 行为：**
1. 构建 `LarkCard { title, content, level: level ?? "info" }`
2. 调用 `this.cli.sendInteractiveCard(this.channelId, card)`

## 错误处理

所有 CLI 调用检查 `exitCode`：
- `exitCode === 127` → lark-cli 未安装，抛出 `LarkCliError` 提示安装
- `exitCode !== 0` → 业务错误，抛出 `LarkCliError` 含 stderr 内容
- stdout 解析失败 → 抛出 `LarkCliError` 说明输出格式异常

## 测试策略

通过注入 mock `CommandRunner` 进行纯单元测试，无需真实 lark-cli 或飞书账号：

- `LarkCli` 构造时正确存储 config
- `sendDm` 调用正确 CLI 命令
- `sendGroupMessage` 含 replyToMessageId 时追加 `--reply-to` 参数
- `sendInteractiveCard` 传递正确 JSON 格式
- `imHistory` 解析 JSON stdout 为 `LarkMessage[]`
- `docRead` 返回 stdout 文本内容
- `contactSearch` / `groupSearch` 解析 JSON 数组
- 非零 exitCode 抛出 `LarkCliError`
- exitCode 127 的错误消息包含安装提示
- `LarkNotifier.sendCard` 调用 `sendInteractiveCard` 并使用配置的 channelId

## 验证标准

- `bunx tsc --noEmit --project packages/lark/tsconfig.json` 零错误
- `bunx biome check packages/lark/src/` 零错误
- `bunx vitest run packages/lark/` 全部通过
- 导出的函数/类型有中文 JSDoc + `@example`
- 无 `any`、无 `!` 非空断言
- `CommandRunner` 接口可注入 mock（无真实 lark-cli 依赖即可测试）
- 认证通过环境变量传递，不硬编码
