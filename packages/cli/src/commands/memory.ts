import { readFileSync } from "node:fs";
import type { TeamslandClient } from "../http-client.js";
import { printError, printJson, printLine } from "../output.js";

type ParsedMemoryArgs =
  | { op: "write"; uri: string; content: string; mode?: string; wait?: boolean }
  | { op: "read"; uri: string }
  | { op: "ls"; uri: string; recursive?: boolean; simple?: boolean }
  | { op: "mkdir"; uri: string; description?: string }
  | { op: "rm"; uri: string; recursive?: boolean }
  | { op: "mv"; fromUri: string; toUri: string }
  | { op: "abstract"; uri: string }
  | { op: "overview"; uri: string }
  | { op: "find"; query: string; uri?: string; limit?: number; since?: string; until?: string }
  | { op: "grep"; uri: string; pattern: string; ignoreCase?: boolean }
  | { op: "glob"; pattern: string; uri?: string }
  | { error: string };

type ScopeResult = { uri: string; consumed: string[] } | { error: string } | null;

type FindDisplayItem = {
  uri: string;
  abstract?: string;
  score?: number;
};

type FindDisplayResult = {
  memories?: FindDisplayItem[];
  resources?: FindDisplayItem[];
  skills?: FindDisplayItem[];
  total?: number;
};

type GrepDisplayResult = {
  matches: Array<{ uri: string; line: number; content: string }>;
  count: number;
};

type GlobDisplayResult = {
  matches: string[];
  count: number;
};

const SCOPE_MAP: Record<string, string> = {
  agent: "viking://agent/teamsland/memories/",
  resources: "viking://resources/",
  tasks: "viking://resources/tasks/",
};

/**
 * 解析记忆命令中的 scope 快捷参数。
 *
 * @example
 * ```typescript
 * const scope = resolveScope(["--scope", "agent"]);
 * console.log(scope);
 * ```
 */
export function resolveScope(args: string[]): ScopeResult {
  const scopeIdx = args.indexOf("--scope");
  if (scopeIdx === -1) return null;

  const scopeName = args[scopeIdx + 1];
  if (!scopeName) return { error: "Missing value for --scope" };

  if (scopeName === "user") {
    const userIdx = args.indexOf("--user");
    const userId = userIdx >= 0 ? args[userIdx + 1] : undefined;
    if (!userId) return { error: "--scope user requires --user <id>" };
    return {
      uri: `viking://user/${userId}/memories/`,
      consumed: ["--scope", scopeName, "--user", userId],
    };
  }

  const uri = SCOPE_MAP[scopeName];
  if (!uri) {
    return { error: `Unknown scope: ${scopeName}. Available: agent, user, tasks, resources` };
  }
  return { uri, consumed: ["--scope", scopeName] };
}

/**
 * 解析 `teamsland memory` 子命令参数。
 *
 * @example
 * ```typescript
 * const parsed = parseMemoryArgs(["find", "部署流程", "--scope", "agent"]);
 * console.log(parsed);
 * ```
 */
export function parseMemoryArgs(args: string[]): ParsedMemoryArgs {
  const op = args[0];
  if (!op) {
    return {
      error:
        "Missing subcommand. Usage: teamsland memory <write|read|ls|mkdir|rm|mv|abstract|overview|find|grep|glob> ...",
    };
  }

  const rest = args.slice(1);
  const scope = resolveScope(rest);
  if (scope && "error" in scope) return { error: scope.error };

  const scopeUri = scope?.uri;
  const effectiveArgs = scope ? removeConsumedArgs(rest, scope.consumed) : rest;

  switch (op) {
    case "write":
      return parseWrite(effectiveArgs);
    case "read":
      return parseUriOnly("read", effectiveArgs, "teamsland memory read <uri>");
    case "ls":
      return parseLs(effectiveArgs, scopeUri);
    case "mkdir":
      return parseMkdir(effectiveArgs);
    case "rm":
      return parseRm(effectiveArgs);
    case "mv":
      return parseMv(effectiveArgs);
    case "abstract":
      return parseUriOnly("abstract", effectiveArgs, "teamsland memory abstract <uri>");
    case "overview":
      return parseUriOnly("overview", effectiveArgs, "teamsland memory overview <uri>");
    case "find":
      return parseFind(effectiveArgs, scopeUri);
    case "grep":
      return parseGrep(effectiveArgs);
    case "glob":
      return parseGlob(effectiveArgs, scopeUri);
    default:
      return {
        error: `Unknown subcommand: ${op}. Available: write, read, ls, mkdir, rm, mv, abstract, overview, find, grep, glob`,
      };
  }
}

/**
 * 执行 `teamsland memory` 子命令。
 *
 * @example
 * ```typescript
 * declare const client: TeamslandClient;
 * await runMemory(client, ["read", "viking://resources/doc.md"], false);
 * ```
 */
export async function runMemory(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const parsed = parseMemoryArgs(args);
  if ("error" in parsed) {
    printError(parsed.error);
    process.exit(1);
  }

  await runParsedMemoryCommand(client, parsed, jsonOutput);
}

function parseWrite(args: string[]): ParsedMemoryArgs {
  const uri = args[0];
  if (!uri) return { error: "Missing URI. Usage: teamsland memory write <uri> --content <text>" };

  const content = extractOption(args, "--content");
  const contentFile = extractOption(args, "--content-file");
  const finalContent = content ?? readContentFile(contentFile);
  if (typeof finalContent !== "string") {
    return finalContent;
  }

  const mode = extractOption(args, "--mode");
  const wait = extractFlag(args, "--wait");
  return {
    op: "write",
    uri,
    content: finalContent,
    ...(mode ? { mode } : {}),
    ...(wait ? { wait: true } : {}),
  };
}

async function runParsedMemoryCommand(
  client: TeamslandClient,
  parsed: Exclude<ParsedMemoryArgs, { error: string }>,
  jsonOutput: boolean,
): Promise<void> {
  switch (parsed.op) {
    case "write":
      return runWrite(client, parsed, jsonOutput);
    case "read":
      return runRead(client, parsed, jsonOutput);
    case "ls":
      return runLs(client, parsed, jsonOutput);
    case "mkdir":
      return runMkdir(client, parsed, jsonOutput);
    case "rm":
      return runRm(client, parsed, jsonOutput);
    case "mv":
      return runMv(client, parsed, jsonOutput);
    case "abstract":
      return runAbstract(client, parsed, jsonOutput);
    case "overview":
      return runOverview(client, parsed, jsonOutput);
    case "find":
      return runFind(client, parsed, jsonOutput);
    case "grep":
      return runGrep(client, parsed, jsonOutput);
    case "glob":
      return runGlob(client, parsed, jsonOutput);
  }
}

async function runWrite(
  client: TeamslandClient,
  parsed: Extract<ParsedMemoryArgs, { op: "write" }>,
  jsonOutput: boolean,
): Promise<void> {
  const result = await client.vikingWrite(parsed.uri, parsed.content, {
    mode: parsed.mode,
    wait: parsed.wait,
  });
  if (jsonOutput) {
    printJson(result);
    return;
  }
  const mode = parsed.mode ?? "replace";
  printLine(`Written: ${parsed.uri} (${mode}, ${parsed.content.length} bytes)`);
}

async function runRead(
  client: TeamslandClient,
  parsed: Extract<ParsedMemoryArgs, { op: "read" }>,
  jsonOutput: boolean,
): Promise<void> {
  const result = await client.vikingRead(parsed.uri);
  printJsonOrLine(jsonOutput, result, result.result);
}

async function runLs(
  client: TeamslandClient,
  parsed: Extract<ParsedMemoryArgs, { op: "ls" }>,
  jsonOutput: boolean,
): Promise<void> {
  const result = await client.vikingLs(parsed.uri, {
    recursive: parsed.recursive,
    simple: parsed.simple,
  });
  if (jsonOutput) {
    printJson(result);
    return;
  }
  const entries = result.result as Array<{ name: string; isDir?: boolean; is_dir?: boolean; uri?: string }>;
  for (const entry of entries) {
    const type = (entry.isDir ?? entry.is_dir) ? "dir " : "file";
    printLine(`  ${type}  ${entry.name}`);
  }
  printLine(`\n${entries.length} entries`);
}

async function runMkdir(
  client: TeamslandClient,
  parsed: Extract<ParsedMemoryArgs, { op: "mkdir" }>,
  jsonOutput: boolean,
): Promise<void> {
  const result = await client.vikingMkdir(parsed.uri, parsed.description);
  printJsonOrLine(jsonOutput, result, `Created: ${parsed.uri}`);
}

async function runRm(
  client: TeamslandClient,
  parsed: Extract<ParsedMemoryArgs, { op: "rm" }>,
  jsonOutput: boolean,
): Promise<void> {
  const result = await client.vikingRm(parsed.uri, parsed.recursive);
  printJsonOrLine(jsonOutput, result, `Deleted: ${parsed.uri}`);
}

async function runMv(
  client: TeamslandClient,
  parsed: Extract<ParsedMemoryArgs, { op: "mv" }>,
  jsonOutput: boolean,
): Promise<void> {
  const result = await client.vikingMv(parsed.fromUri, parsed.toUri);
  printJsonOrLine(jsonOutput, result, `Moved: ${parsed.fromUri} -> ${parsed.toUri}`);
}

async function runAbstract(
  client: TeamslandClient,
  parsed: Extract<ParsedMemoryArgs, { op: "abstract" }>,
  jsonOutput: boolean,
): Promise<void> {
  const result = await client.vikingAbstract(parsed.uri);
  printJsonOrLine(jsonOutput, result, result.result);
}

async function runOverview(
  client: TeamslandClient,
  parsed: Extract<ParsedMemoryArgs, { op: "overview" }>,
  jsonOutput: boolean,
): Promise<void> {
  const result = await client.vikingOverview(parsed.uri);
  printJsonOrLine(jsonOutput, result, result.result);
}

async function runFind(
  client: TeamslandClient,
  parsed: Extract<ParsedMemoryArgs, { op: "find" }>,
  jsonOutput: boolean,
): Promise<void> {
  const response = await client.vikingFind(parsed.query, {
    targetUri: parsed.uri,
    limit: parsed.limit,
    since: parsed.since,
    until: parsed.until,
  });
  if (jsonOutput) {
    printJson(response);
    return;
  }
  printFindResult(unwrapProxyResult<FindDisplayResult>(response));
}

async function runGrep(
  client: TeamslandClient,
  parsed: Extract<ParsedMemoryArgs, { op: "grep" }>,
  jsonOutput: boolean,
): Promise<void> {
  const response = await client.vikingGrep(parsed.uri, parsed.pattern, {
    caseInsensitive: parsed.ignoreCase,
  });
  if (jsonOutput) {
    printJson(response);
    return;
  }
  printGrepResult(unwrapProxyResult<GrepDisplayResult>(response));
}

async function runGlob(
  client: TeamslandClient,
  parsed: Extract<ParsedMemoryArgs, { op: "glob" }>,
  jsonOutput: boolean,
): Promise<void> {
  const response = await client.vikingGlob(parsed.pattern, parsed.uri);
  if (jsonOutput) {
    printJson(response);
    return;
  }
  printGlobResult(unwrapProxyResult<GlobDisplayResult>(response));
}

function printJsonOrLine(jsonOutput: boolean, result: unknown, line: string): void {
  if (jsonOutput) {
    printJson(result);
    return;
  }
  printLine(line);
}

function printFindResult(result: FindDisplayResult): void {
  const items = [...(result.memories ?? []), ...(result.resources ?? []), ...(result.skills ?? [])];
  if (items.length === 0) {
    printLine("No results found.");
    return;
  }
  for (const item of items) {
    const score = typeof item.score === "number" ? item.score.toFixed(2) : "?";
    printLine(`  [${score}] ${item.uri}`);
    printLine(`         ${item.abstract?.slice(0, 120) ?? ""}`);
  }
  printLine(`\n${items.length} results`);
}

function printGrepResult(result: GrepDisplayResult): void {
  if (result.count === 0) {
    printLine("No matches found.");
    return;
  }
  for (const match of result.matches) {
    printLine(`  ${match.uri}:${match.line}: ${match.content}`);
  }
  printLine(`\n${result.count} matches`);
}

function printGlobResult(result: GlobDisplayResult): void {
  if (result.count === 0) {
    printLine("No matches found.");
    return;
  }
  for (const uri of result.matches) {
    printLine(`  ${uri}`);
  }
  printLine(`\n${result.count} matches`);
}

function parseUriOnly(op: "read" | "abstract" | "overview", args: string[], usage: string): ParsedMemoryArgs {
  const uri = args[0];
  if (!uri) return { error: `Missing URI. Usage: ${usage}` };
  return { op, uri };
}

function parseLs(args: string[], scopeUri: string | undefined): ParsedMemoryArgs {
  const uri = args[0] ?? scopeUri;
  if (!uri) return { error: "Missing URI. Usage: teamsland memory ls <uri>" };
  const recursive = extractFlag(args, "--recursive");
  const simple = extractFlag(args, "--simple");
  return { op: "ls", uri, ...(recursive ? { recursive: true } : {}), ...(simple ? { simple: true } : {}) };
}

function parseMkdir(args: string[]): ParsedMemoryArgs {
  const uri = args[0];
  if (!uri) return { error: "Missing URI. Usage: teamsland memory mkdir <uri>" };
  const description = extractOption(args, "--description");
  return { op: "mkdir", uri, ...(description ? { description } : {}) };
}

function parseRm(args: string[]): ParsedMemoryArgs {
  const uri = args[0];
  if (!uri) return { error: "Missing URI. Usage: teamsland memory rm <uri>" };
  const recursive = extractFlag(args, "--recursive");
  return { op: "rm", uri, ...(recursive ? { recursive: true } : {}) };
}

function parseMv(args: string[]): ParsedMemoryArgs {
  const fromUri = args[0];
  const toUri = args[1];
  if (!fromUri || !toUri) return { error: "Missing URIs. Usage: teamsland memory mv <from-uri> <to-uri>" };
  return { op: "mv", fromUri, toUri };
}

function parseFind(args: string[], scopeUri: string | undefined): ParsedMemoryArgs {
  const query = args[0];
  if (!query) return { error: "Missing query. Usage: teamsland memory find <query>" };
  const limitStr = extractOption(args, "--limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined;
  const since = extractOption(args, "--since");
  const until = extractOption(args, "--until");
  const uri = extractOption(args, "--uri") ?? scopeUri;
  return {
    op: "find",
    query,
    ...(uri ? { uri } : {}),
    ...(Number.isFinite(limit) && limit !== undefined ? { limit } : {}),
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
  };
}

function parseGrep(args: string[]): ParsedMemoryArgs {
  const uri = args[0];
  const pattern = args[1];
  if (!uri || !pattern) return { error: "Missing URI or pattern. Usage: teamsland memory grep <uri> <pattern>" };
  const ignoreCase = extractFlag(args, "--ignore-case");
  return { op: "grep", uri, pattern, ...(ignoreCase ? { ignoreCase: true } : {}) };
}

function parseGlob(args: string[], scopeUri: string | undefined): ParsedMemoryArgs {
  const pattern = args[0];
  if (!pattern) return { error: "Missing pattern. Usage: teamsland memory glob <pattern>" };
  const uri = extractOption(args, "--uri") ?? scopeUri;
  return { op: "glob", pattern, ...(uri ? { uri } : {}) };
}

function readContentFile(filePath: string | undefined): string | { error: string } {
  if (filePath === undefined) {
    return { error: "Missing --content or --content-file. Usage: teamsland memory write <uri> --content <text>" };
  }
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return { error: `Cannot read file: ${filePath}` };
  }
}

function extractFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function extractOption(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function removeConsumedArgs(args: string[], consumed: string[]): string[] {
  const result = [...args];
  for (const token of consumed) {
    const index = result.indexOf(token);
    if (index >= 0) {
      result.splice(index, 1);
    }
  }
  return result;
}

function unwrapProxyResult<T>(response: unknown): T {
  if (isRecord(response) && "result" in response) {
    return response.result as T;
  }
  return response as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
