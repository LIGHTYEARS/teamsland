// @teamsland/lark — lark-cli wrapper, LarkNotifier, LarkConnector
// 通过 CommandRunner 抽象调用外部 lark-cli 二进制，提供消息、文档、群组操作

export type { CommandResult, CommandRunner } from "./command-runner.js";
export { BunCommandRunner } from "./command-runner.js";
export type { LarkConnectorOpts } from "./connector.js";
export { LarkConnector } from "./connector.js";
export { LarkCli, LarkCliError } from "./lark-cli.js";
export { LarkNotifier } from "./notifier.js";
export type { LarkCard, LarkContact, LarkGroup, LarkMessage } from "./types.js";
