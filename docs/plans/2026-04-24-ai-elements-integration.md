# AI Elements Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 Vercel AI Elements 源码中 cherry-pick 核心聊天组件到 Teamsland Dashboard，替换自研的 MessageBubble/MessageList/MessageInput，同时保留业务定制组件（Sidebar/Shell/CodeEditor/GitPanel）不动。

**Architecture:** 新建 `packages/ui` 包（对标 AI Elements 的 `@repo/shadcn-ui`），作为共享 UI 基础层。从 AI Elements 拷贝 7 个核心组件源码到 `packages/ui/elements/`，修改 import 路径和类型适配。在 `@teamsland/types` 中新增 `toUIMessage()` 适配函数桥接 `NormalizedMessage → UIMessage`。Dashboard 渐进式替换，每个 Task 产出可独立验证的变更。

**Tech Stack:** React 19, Tailwind v4, shadcn/ui (Radix primitives), streamdown (Markdown), shiki (代码高亮), class-variance-authority, clsx + tailwind-merge

---

## 依赖关系图

```
packages/ui/                          ← 新建
  ├── lib/utils.ts                    ← cn() 工具函数
  ├── components/ui/                  ← 从 AI Elements 拷贝的 shadcn/ui 基础组件
  │   ├── button.tsx                  ← message, conversation, terminal, code-block, confirmation
  │   ├── button-group.tsx            ← message (branch 切换)
  │   ├── tooltip.tsx                 ← message (actions tooltip)
  │   ├── badge.tsx                   ← tool (status badge)
  │   ├── collapsible.tsx             ← tool, reasoning (折叠)
  │   ├── alert.tsx                   ← confirmation (权限确认)
  │   └── select.tsx                  ← code-block (语言选择器)
  └── elements/                       ← 从 AI Elements 拷贝并适配的业务组件
      ├── message.tsx                 ← 替换 MessageBubble
      ├── conversation.tsx            ← 替换 MessageList
      ├── reasoning.tsx               ← 替换 ThinkingBlock
      ├── tool.tsx                    ← 替换 ToolRenderer
      ├── terminal.tsx                ← 替换 BashOutput
      ├── code-block.tsx              ← 新增代码高亮展示
      ├── confirmation.tsx            ← 替换 PermissionBlock
      └── shimmer.tsx                 ← reasoning 依赖的 loading 动画
```

## 最小 shadcn/ui 子集

只拷贝 7 个核心组件被实际 import 的 shadcn/ui 文件（非全量 24 个）：

| shadcn/ui 组件 | 被哪些 elements 使用 |
|---|---|
| `button.tsx` | message, conversation, terminal, code-block, confirmation |
| `button-group.tsx` | message (branch 切换) |
| `tooltip.tsx` | message (actions tooltip) |
| `badge.tsx` | tool (status badge) |
| `collapsible.tsx` | tool, reasoning |
| `alert.tsx` | confirmation |
| `select.tsx` | code-block (语言选择器) |

## 关键适配点

### 1. 类型桥接：NormalizedMessage → AI Elements Props

AI Elements 的 Message 组件接收 `from: UIMessage["role"]`（即 `"user" | "assistant" | "system"`），MessageResponse 接收 `content: string`（Markdown 文本）。

我们不需要把所有数据转换为 Vercel `ai` SDK 的 `UIMessage` 类型。**只需在 Dashboard 层做 Props 映射**：

```tsx
// 示例：Dashboard 层直接传 props，不需要全局类型转换
<Message from={msg.role ?? "assistant"}>
  <MessageContent>
    {msg.kind === "text" ? (
      <MessageResponse content={msg.content ?? ""} />
    ) : msg.kind === "tool_use" ? (
      <Tool name={msg.toolName} ...>
    ) : ...}
  </MessageContent>
</Message>
```

### 2. Import 路径重写

所有 `@repo/shadcn-ui/xxx` → `@teamsland/ui/xxx`
所有 `ai` SDK 类型 → 移除或替换为 `@teamsland/types` 等价类型

### 3. `streamdown` 替换 `react-markdown`

AI Elements 用 Vercel 自研的 `streamdown` 做 Markdown 渲染（支持流式、数学公式、Mermaid）。
这是升级，直接引入。同时移除 `react-markdown` + `remark-gfm` + `rehype-raw`。

### 4. `"use client"` 指令

AI Elements 每个文件顶部都有 `"use client"`。在 Rspack 环境下无实际意义但不会报错。**保留原样**，不做修改。

---

## Task 1: 创建 `packages/ui` 基础包

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/lib/utils.ts`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "@teamsland/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./lib/*": "./lib/*.ts",
    "./components/ui/*": "./components/ui/*.tsx",
    "./elements/*": "./elements/*.tsx"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.4.0",
    "class-variance-authority": "^0.7.1",
    "radix-ui": "latest",
    "lucide-react": "^0.577.0",
    "react": "^19.1",
    "react-dom": "^19.1"
  },
  "devDependencies": {
    "@types/react": "^19.1",
    "@types/react-dom": "^19.1"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": ".",
    "skipLibCheck": true,
    "paths": {
      "@teamsland/ui/*": ["./*"]
    }
  },
  "include": ["lib", "components", "elements"]
}
```

- [ ] **Step 3: 创建 lib/utils.ts**

从 AI Elements 拷贝 `packages/shadcn-ui/lib/utils.ts`，内容为 `cn()` 函数。

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: 安装依赖**

Run: `cd /Users/bytedance/workspace/teamsland && bun install`

- [ ] **Step 5: 验证**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck --filter @teamsland/ui`

---

## Task 2: 拷贝最小 shadcn/ui 子集

**Files:**
- Create: `packages/ui/components/ui/button.tsx`
- Create: `packages/ui/components/ui/button-group.tsx`
- Create: `packages/ui/components/ui/tooltip.tsx`
- Create: `packages/ui/components/ui/badge.tsx`
- Create: `packages/ui/components/ui/collapsible.tsx`
- Create: `packages/ui/components/ui/alert.tsx`
- Create: `packages/ui/components/ui/select.tsx`
- Create: `packages/ui/components/ui/spinner.tsx`

**Source:** `/tmp/ai-elements/packages/shadcn-ui/components/ui/`

- [ ] **Step 1: 批量拷贝 8 个 shadcn/ui 文件**

从 AI Elements 拷贝以下文件到 `packages/ui/components/ui/`：
- `button.tsx`
- `button-group.tsx`
- `tooltip.tsx`
- `badge.tsx`
- `collapsible.tsx`
- `alert.tsx`
- `select.tsx`
- `spinner.tsx`

- [ ] **Step 2: 全局替换 import 路径**

在每个拷贝的文件中：
- `@repo/shadcn-ui/lib/utils` → `@teamsland/ui/lib/utils`
- 如果有跨文件引用（如 button-group 引用 button），改为相对路径 `./button`

- [ ] **Step 3: 补充 Radix 依赖**

检查每个 shadcn/ui 组件的 Radix 依赖，确保 `packages/ui/package.json` 的 `radix-ui` 包含了所有必需的 primitives。

- [ ] **Step 4: 验证编译**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck --filter @teamsland/ui`

---

## Task 3: 拷贝核心 Elements 组件

**Files:**
- Create: `packages/ui/elements/message.tsx`
- Create: `packages/ui/elements/conversation.tsx`
- Create: `packages/ui/elements/reasoning.tsx`
- Create: `packages/ui/elements/tool.tsx`
- Create: `packages/ui/elements/terminal.tsx`
- Create: `packages/ui/elements/code-block.tsx`
- Create: `packages/ui/elements/confirmation.tsx`
- Create: `packages/ui/elements/shimmer.tsx`

**Source:** `/tmp/ai-elements/packages/elements/src/`

- [ ] **Step 1: 批量拷贝 8 个 elements 文件**

从 AI Elements 拷贝以下文件到 `packages/ui/elements/`：
- `message.tsx`
- `conversation.tsx`
- `reasoning.tsx`
- `tool.tsx`
- `terminal.tsx`
- `code-block.tsx`
- `confirmation.tsx`
- `shimmer.tsx`

- [ ] **Step 2: 全局替换 import 路径**

在每个拷贝的文件中：
- `@repo/shadcn-ui/components/ui/xxx` → `@teamsland/ui/components/ui/xxx`
- `@repo/shadcn-ui/lib/utils` → `@teamsland/ui/lib/utils`
- elements 之间互相引用（如 `tool.tsx` import `./code-block`）保持相对路径

- [ ] **Step 3: 移除 `ai` SDK 类型依赖**

对每个文件中 `import type { UIMessage, ToolUIPart, ChatStatus } from "ai"` 进行替换：

```ts
// 在 packages/ui/elements/types.ts 中定义本地等价类型
export type MessageRole = "user" | "assistant" | "system";
export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-denied";
export type ChatStatus = "submitted" | "streaming" | "ready" | "error";
```

各组件改为从 `./types` import 这些类型。

- [ ] **Step 4: 添加第三方依赖到 package.json**

```json
{
  "dependencies": {
    "streamdown": "^2.4.0",
    "@streamdown/cjk": "^1.0.2",
    "@streamdown/code": "^1.1.0",
    "@streamdown/math": "^1.0.2",
    "@streamdown/mermaid": "^1.0.2",
    "shiki": "3.22.0",
    "ansi-to-react": "^6.2.6",
    "motion": "^12.26.2",
    "use-stick-to-bottom": "^1.1.3"
  }
}
```

- [ ] **Step 5: 安装依赖并验证编译**

Run: `cd /Users/bytedance/workspace/teamsland && bun install && bun run typecheck --filter @teamsland/ui`

---

## Task 4: Dashboard 添加 `@teamsland/ui` 依赖 + CSS 变量

**Files:**
- Modify: `apps/dashboard/package.json`
- Modify: `apps/dashboard/src/index.css`

- [ ] **Step 1: 添加 workspace 依赖**

在 `apps/dashboard/package.json` 的 `dependencies` 中添加：

```json
"@teamsland/ui": "workspace:*"
```

- [ ] **Step 2: 注入 CSS 变量**

AI Elements 组件通过 CSS 变量（`--background`, `--foreground`, `--secondary`, `--muted-foreground` 等）控制配色。
在 `apps/dashboard/src/index.css` 中添加：

```css
@import "tailwindcss";

@layer base {
  :root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.145 0 0);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.145 0 0);
    --popover: oklch(1 0 0);
    --popover-foreground: oklch(0.145 0 0);
    --primary: oklch(0.205 0 0);
    --primary-foreground: oklch(0.985 0 0);
    --secondary: oklch(0.97 0 0);
    --secondary-foreground: oklch(0.205 0 0);
    --muted: oklch(0.97 0 0);
    --muted-foreground: oklch(0.556 0 0);
    --accent: oklch(0.97 0 0);
    --accent-foreground: oklch(0.205 0 0);
    --destructive: oklch(0.577 0.245 27.325);
    --border: oklch(0.922 0 0);
    --input: oklch(0.922 0 0);
    --ring: oklch(0.708 0 0);
    --radius: 0.625rem;
    --sidebar: oklch(0.985 0 0);
    --sidebar-foreground: oklch(0.145 0 0);
  }
}
```

- [ ] **Step 3: 安装依赖并验证**

Run: `cd /Users/bytedance/workspace/teamsland && bun install`

---

## Task 5: 替换 MessageList → Conversation

**Files:**
- Modify: `apps/dashboard/src/components/chat/ChatInterface.tsx`
- Modify: `apps/dashboard/src/components/chat/MessageList.tsx` → Deprecated, 逐步替换

- [ ] **Step 1: 在 ChatInterface 中引入 Conversation 容器**

将 `MessageList` 的外层容器替换为 `Conversation` + `ConversationContent`，保持内部消息渲染逻辑（tool_use/tool_result 配对）不变。

```tsx
import { Conversation, ConversationContent, ConversationScrollButton } from "@teamsland/ui/elements/conversation";

// ChatInterface 内部
<Conversation>
  <ConversationContent>
    {messages.map(msg => ...渲染逻辑...)}
    {isStreaming && <StreamingIndicator />}
  </ConversationContent>
  <ConversationScrollButton />
</Conversation>
```

- [ ] **Step 2: 验证自动滚动功能**

`use-stick-to-bottom` 替代了手动的 `scrollIntoView` 逻辑。验证新消息到达时自动滚动。

- [ ] **Step 3: 标记 MessageList.tsx 为 @deprecated**

---

## Task 6: 替换 MessageBubble → Message

**Files:**
- Modify: `apps/dashboard/src/components/chat/MessageBubble.tsx` 重写

- [ ] **Step 1: 用 Message + MessageContent 替换手写气泡**

```tsx
import { Message, MessageContent, MessageResponse } from "@teamsland/ui/elements/message";
import { Reasoning } from "@teamsland/ui/elements/reasoning";
import { Tool, ToolContent, ToolStatus } from "@teamsland/ui/elements/tool";
import { Terminal, TerminalCommand, TerminalOutput } from "@teamsland/ui/elements/terminal";
import { Confirmation, ConfirmationTitle, ConfirmationActions, ConfirmationAction, ConfirmationRequest } from "@teamsland/ui/elements/confirmation";
```

- [ ] **Step 2: 重写 KIND_RENDERERS 映射**

```tsx
// text → MessageResponse (Streamdown Markdown)
text: ({ message }) => (
  <Message from={message.role ?? "assistant"}>
    <MessageContent>
      <MessageResponse content={message.content ?? ""} />
    </MessageContent>
  </Message>
),

// thinking → Reasoning
thinking: ({ message }) => (
  <Reasoning content={message.content ?? ""} />
),

// tool_use → Tool
tool_use: ({ message, toolResult }) => (
  <Tool name={message.toolName ?? "unknown"} state="output-available">
    <ToolContent>{/* 工具输入/输出展示 */}</ToolContent>
    {toolResult && <ToolStatus>...</ToolStatus>}
  </Tool>
),

// permission_request → Confirmation
permission_request: ({ message, onPermissionResponse }) => (
  <Confirmation state="approval-requested" approval={{ id: message.id }}>
    <ConfirmationTitle>{message.toolName}</ConfirmationTitle>
    <ConfirmationRequest>
      <ConfirmationActions>
        <ConfirmationAction onClick={() => onPermissionResponse?.(message.id, "allow")}>允许</ConfirmationAction>
        <ConfirmationAction variant="outline" onClick={() => onPermissionResponse?.(message.id, "deny")}>拒绝</ConfirmationAction>
      </ConfirmationActions>
    </ConfirmationRequest>
  </Confirmation>
),
```

- [ ] **Step 3: 验证所有消息类型渲染正确**

刷新 Dashboard，逐一检查 text / tool_use / tool_result / thinking / error / permission_request / status 类型。

---

## Task 7: 替换 MessageInput → PromptInput (可选)

**Files:**
- Modify: `apps/dashboard/src/components/chat/MessageInput.tsx` → 考虑替换

注意：PromptInput 组件体积大（1400+ 行），且依赖 `@repo/shadcn-ui` 的 command, dropdown-menu, hover-card, input-group, select 等多个额外组件。

**建议决策：暂不替换**。当前 MessageInput 功能简单（文本输入 + 发送），PromptInput 的文件附件、截图、model selector 等能力短期内用不到。待后续需要高级输入功能时再引入。

如需引入，额外需拷贝的 shadcn/ui 组件：
- `command.tsx`, `dropdown-menu.tsx`, `hover-card.tsx`, `input-group.tsx`

---

## Task 8: 清理旧依赖

**Files:**
- Modify: `apps/dashboard/package.json`

- [ ] **Step 1: 移除不再使用的依赖**

如果 `react-markdown`, `remark-gfm`, `rehype-raw` 不再被任何组件使用（已被 `streamdown` 替代），则从 `package.json` 中移除。

- [ ] **Step 2: 验证构建**

Run: `cd /Users/bytedance/workspace/teamsland && bun run build --filter @teamsland/dashboard`

---

## Task 9: Lint + TypeCheck 全局验证

- [ ] **Step 1: Biome lint**

Run: `cd /Users/bytedance/workspace/teamsland && bun run lint`

- [ ] **Step 2: TypeScript check**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck`

- [ ] **Step 3: 测试不回归**

Run: `cd /Users/bytedance/workspace/teamsland && bun run test:run`

---

## 风险与降级策略

| 风险 | 概率 | 降级策略 |
|---|---|---|
| shadcn/ui Radix 版本冲突 | 中 | 用 `radix-ui` latest 包（已统一），若冲突则 pin 到 AI Elements 使用的版本 |
| `streamdown` 在 Rspack 下 WASM 加载失败 | 低 | 回退到 `react-markdown`，只在 Message 层做条件切换 |
| CSS 变量与现有 Tailwind 样式冲突 | 低 | CSS 变量用 oklch 色值不会覆盖 Tailwind 的 utility classes |
| `shiki` bundle 体积过大 | 中 | 使用 shiki 的动态 import + 按需加载语言语法 |
| lucide-react 版本冲突 (^0.577 vs ^1.8) | 高 | 统一到 AI Elements 的 ^0.577 或升级 AI Elements 到 ^1.8，需验证图标 API 兼容性 |

## 不变更清单（保留自研）

以下组件不做替换，保持现状：
- `Shell.tsx` — xterm.js 交互终端，AI Elements Terminal 是静态渲染
- `CodeEditor.tsx` — CodeMirror 编辑器，AI Elements CodeBlock 是只读展示
- `GitPanel.tsx` — 业务定制
- `Sidebar.tsx` / `ProjectList.tsx` / `SessionList.tsx` / `SessionFilters.tsx` — 业务定制
- `TopologyView.tsx` / `TopologyNode.tsx` / `EdgePath.tsx` — 已用 @xyflow/react，无需改动
- `EventViewer.tsx` / `AgentList.tsx` / `AuthGate.tsx` — 业务定制
- `AppLayout.tsx` / `DetailPanel.tsx` — 布局组件
