import { describe, expect, it } from "vitest";
import { parseMemoryArgs, resolveScope } from "../commands/memory.js";

describe("parseMemoryArgs", () => {
  it("parses 'write <uri> --content <text> --mode create'", () => {
    const result = parseMemoryArgs([
      "write",
      "viking://agent/teamsland/memories/note.md",
      "--content",
      "hello world",
      "--mode",
      "create",
    ]);
    expect(result).toEqual({
      op: "write",
      uri: "viking://agent/teamsland/memories/note.md",
      content: "hello world",
      mode: "create",
    });
  });

  it("parses 'write <uri> --content <text>' with default mode", () => {
    const result = parseMemoryArgs(["write", "viking://agent/teamsland/memories/note.md", "--content", "hello"]);
    expect(result).toEqual({
      op: "write",
      uri: "viking://agent/teamsland/memories/note.md",
      content: "hello",
    });
  });

  it("parses 'write' with --wait flag", () => {
    const result = parseMemoryArgs(["write", "viking://resources/doc.md", "--content", "text", "--wait"]);
    expect(result).toEqual({
      op: "write",
      uri: "viking://resources/doc.md",
      content: "text",
      wait: true,
    });
  });

  it("returns error when write has no --content or --content-file", () => {
    const result = parseMemoryArgs(["write", "viking://resources/doc.md"]);
    expect(result).toHaveProperty("error");
  });

  it("parses 'read <uri>'", () => {
    const result = parseMemoryArgs(["read", "viking://agent/teamsland/memories/note.md"]);
    expect(result).toEqual({ op: "read", uri: "viking://agent/teamsland/memories/note.md" });
  });

  it("parses 'ls <uri> --recursive'", () => {
    const result = parseMemoryArgs(["ls", "viking://resources/", "--recursive"]);
    expect(result).toEqual({ op: "ls", uri: "viking://resources/", recursive: true });
  });

  it("parses 'mkdir <uri> --description <text>'", () => {
    const result = parseMemoryArgs(["mkdir", "viking://resources/new/", "--description", "project docs"]);
    expect(result).toEqual({ op: "mkdir", uri: "viking://resources/new/", description: "project docs" });
  });

  it("parses 'rm <uri> --recursive'", () => {
    const result = parseMemoryArgs(["rm", "viking://resources/old/", "--recursive"]);
    expect(result).toEqual({ op: "rm", uri: "viking://resources/old/", recursive: true });
  });

  it("parses 'mv <from> <to>'", () => {
    const result = parseMemoryArgs(["mv", "viking://resources/old/", "viking://resources/new/"]);
    expect(result).toEqual({ op: "mv", fromUri: "viking://resources/old/", toUri: "viking://resources/new/" });
  });

  it("parses 'abstract <uri>'", () => {
    const result = parseMemoryArgs(["abstract", "viking://resources/docs/"]);
    expect(result).toEqual({ op: "abstract", uri: "viking://resources/docs/" });
  });

  it("parses 'overview <uri>'", () => {
    const result = parseMemoryArgs(["overview", "viking://resources/docs/"]);
    expect(result).toEqual({ op: "overview", uri: "viking://resources/docs/" });
  });

  it("parses 'find <query> --uri <target> --limit 5'", () => {
    const result = parseMemoryArgs(["find", "部署流程", "--uri", "viking://agent/teamsland/memories/", "--limit", "5"]);
    expect(result).toEqual({
      op: "find",
      query: "部署流程",
      uri: "viking://agent/teamsland/memories/",
      limit: 5,
    });
  });

  it("parses 'find' with --scope agent", () => {
    const result = parseMemoryArgs(["find", "部署", "--scope", "agent", "--limit", "3"]);
    expect(result).toEqual({
      op: "find",
      query: "部署",
      uri: "viking://agent/teamsland/memories/",
      limit: 3,
    });
  });

  it("parses 'find' with --since and --until", () => {
    const result = parseMemoryArgs(["find", "invoice", "--since", "7d", "--until", "1d"]);
    expect(result).toEqual({
      op: "find",
      query: "invoice",
      since: "7d",
      until: "1d",
    });
  });

  it("parses 'grep <uri> <pattern> --ignore-case'", () => {
    const result = parseMemoryArgs(["grep", "viking://resources/", "auth", "--ignore-case"]);
    expect(result).toEqual({
      op: "grep",
      uri: "viking://resources/",
      pattern: "auth",
      ignoreCase: true,
    });
  });

  it("parses 'glob <pattern> --uri <target>'", () => {
    const result = parseMemoryArgs(["glob", "**/*.md", "--uri", "viking://resources/"]);
    expect(result).toEqual({
      op: "glob",
      pattern: "**/*.md",
      uri: "viking://resources/",
    });
  });

  it("returns error for missing subcommand", () => {
    const result = parseMemoryArgs([]);
    expect(result).toHaveProperty("error");
  });

  it("returns error for unknown subcommand", () => {
    const result = parseMemoryArgs(["unknown"]);
    expect(result).toHaveProperty("error");
  });
});

describe("resolveScope", () => {
  it("resolves --scope agent", () => {
    expect(resolveScope(["--scope", "agent"])).toEqual({
      uri: "viking://agent/teamsland/memories/",
      consumed: ["--scope", "agent"],
    });
  });

  it("resolves --scope user --user alice", () => {
    expect(resolveScope(["--scope", "user", "--user", "alice"])).toEqual({
      uri: "viking://user/alice/memories/",
      consumed: ["--scope", "user", "--user", "alice"],
    });
  });

  it("resolves --scope tasks", () => {
    expect(resolveScope(["--scope", "tasks"])).toEqual({
      uri: "viking://resources/tasks/",
      consumed: ["--scope", "tasks"],
    });
  });

  it("resolves --scope resources", () => {
    expect(resolveScope(["--scope", "resources"])).toEqual({
      uri: "viking://resources/",
      consumed: ["--scope", "resources"],
    });
  });

  it("returns error for --scope user without --user", () => {
    const result = resolveScope(["--scope", "user"]);
    expect(result).toHaveProperty("error");
  });

  it("returns null when no --scope present", () => {
    expect(resolveScope(["--limit", "5"])).toBeNull();
  });
});
