# @teamsland/config — 配置加载器设计

> 日期：2026-04-19
> 状态：已批准
> 依赖：`@teamsland/types`（AppConfig 等类型定义）

## 概述

`@teamsland/config` 负责从单一 JSON 配置文件加载全局配置，执行环境变量替换，返回类型安全的 `AppConfig` 对象。同时提供 `RepoMapping` 便利类用于 Meego 项目到 Git 仓库的查找。

## 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 配置格式 | JSON（非 YAML） | 零第三方依赖，`Bun.file().json()` 原生解析，类型严格无隐式转换 |
| 配置文件数 | 单一 `config/config.json` | 替代原有 11 个分散 YAML 文件，简化加载逻辑 |
| key 命名 | camelCase | JSON 直接使用 camelCase，无需 snake→camelCase 运行时转换 |
| 环境变量 | `${VAR_NAME}` 占位符，递归替换 | 敏感信息（密钥等）不硬编码在配置文件中 |
| 缺失环境变量 | 抛错（fail-fast） | 不静默留空，启动时立刻暴露配置问题 |
| 第三方依赖 | 无 | JSON 由 Bun 原生解析，环境变量替换自实现 |

## 配置文件

合并原有 11 个 YAML 为 `config/config.json`，顶层 key 对应各子系统：

```json
{
  "meego": { ... },
  "lark": { "appId": "${LARK_APP_ID}", "appSecret": "${LARK_APP_SECRET}", ... },
  "session": { ... },
  "sidecar": { ... },
  "memory": { ... },
  "storage": { ... },
  "confirmation": { ... },
  "dashboard": { ... },
  "repoMapping": [ ... ],
  "skillRouting": { ... }
}
```

完整内容见下方实现计划。删除 `config/` 下原有的 11 个 YAML 文件（保留 `config/test.yaml`，它不属于 AppConfig）。

## 文件结构

```
packages/config/src/
├── index.ts          # barrel 导出
├── loader.ts         # loadConfig() 主函数
├── env.ts            # resolveEnvVars() 环境变量递归替换
└── repo-mapping.ts   # RepoMapping 类
```

## API

### `loadConfig(configPath?: string): Promise<AppConfig>`

```typescript
import { loadConfig } from "@teamsland/config";

// 默认路径：config/config.json（相对于 cwd）
const config = await loadConfig();

// 自定义路径
const config = await loadConfig("/absolute/path/to/config.json");

// 类型安全访问
config.meego.spaces[0].name;       // string
config.lark.appId;                  // 从 ${LARK_APP_ID} 解析后的实际值
config.sidecar.maxConcurrentSessions; // number
```

**行为：**
1. `Bun.file(configPath).json()` 读取 JSON
2. `resolveEnvVars()` 递归替换所有 `${VAR_NAME}` 占位符
3. 返回 `AppConfig` 类型对象

**错误场景：**
- 文件不存在 → 抛 `Error("配置文件不存在: {path}")`
- JSON 解析失败 → Bun 原生抛 `SyntaxError`
- 环境变量未定义 → 抛 `Error("环境变量未定义: {VAR_NAME}")`

### `resolveEnvVars(obj: unknown): unknown`

递归遍历对象/数组，将 string 中的 `${VAR_NAME}` 替换为 `process.env.VAR_NAME`。

规则：
- 支持字符串中混合多个变量：`"prefix-${A}-${B}"` → `"prefix-val_a-val_b"`
- 整个 string 就是一个变量引用时，替换为实际值（仍为 string）
- 非 string 值（number、boolean、null、array、object）递归处理但不替换
- 变量名仅匹配 `[A-Z0-9_]`（大写字母、数字、下划线）

### `RepoMapping`

```typescript
import { RepoMapping } from "@teamsland/config";
import type { RepoMappingConfig, RepoEntry } from "@teamsland/types";

const mapping = RepoMapping.fromConfig(config.repoMapping);

mapping.resolve("project_xxx");
// → [{ path: "/home/user/repos/frontend-main", name: "前端主仓库" }, ...]

mapping.resolve("unknown_project");
// → []
```

**实现：** 内部是 `Map<string, RepoEntry[]>`，`fromConfig()` 静态工厂方法从 `RepoMappingConfig` 构造。

## 测试

使用 Vitest，测试文件放在 `packages/config/src/__tests__/` 下：

### env.test.ts
- 替换单个 `${VAR}` → 实际值
- 字符串中混合多个 `${A}-${B}` 替换
- 嵌套对象/数组中的递归替换
- 未定义的环境变量 → 抛错
- 非 string 值（number、boolean）不受影响

### loader.test.ts
- 加载有效 JSON → 返回 AppConfig
- 文件不存在 → 抛错
- 环境变量替换在加载流程中正确执行

### repo-mapping.test.ts
- `resolve()` 匹配已知 projectId → 返回 repos
- `resolve()` 未知 projectId → 返回空数组
- `fromConfig()` 正确构造映射

## 验证标准

- `bunx tsc --noEmit --project packages/config/tsconfig.json` 零错误
- `bunx biome check packages/config/src/` 零错误
- `bun test packages/config/` 全部通过
- 所有导出的函数/类有中文 JSDoc + `@example`
- 无 `any`、无 `!` 非空断言
