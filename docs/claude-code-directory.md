# Explore the .claude directory

> Where Claude Code reads CLAUDE.md, settings.json, hooks, skills, commands, subagents, rules, and auto memory.

Claude Code reads instructions, settings, skills, subagents, and memory from your project directory and from `~/.claude` in your home directory. Commit project files to git to share them with your team; files in `~/.claude` are personal configuration that applies across all your projects.

Most users only edit `CLAUDE.md` and `settings.json`. The rest of the directory is optional: add skills, rules, or subagents as you need them.

## Project directory structure

```
your-project/
├── CLAUDE.md                          # Project instructions loaded every session (committed)
├── .mcp.json                          # Project-scoped MCP servers, shared with team (committed)
├── .worktreeinclude                   # Gitignored files to copy into new worktrees (committed)
└── .claude/
    ├── settings.json                  # Permissions, hooks, configuration (committed)
    ├── settings.local.json            # Personal settings overrides (gitignored)
    ├── rules/                         # Topic-scoped instructions, optionally path-gated (committed)
    │   ├── testing.md
    │   └── api-design.md
    ├── skills/                        # Reusable prompts invoked with /name (committed)
    │   └── security-review/
    │       ├── SKILL.md
    │       └── checklist.md
    ├── commands/                       # Single-file prompts invoked with /name (committed)
    │   └── fix-issue.md
    ├── output-styles/                  # Custom system-prompt sections (committed)
    ├── agents/                         # Specialized subagents with own context window (committed)
    │   └── code-reviewer.md
    └── agent-memory/                   # Subagent persistent memory (committed, auto-generated)
        └── <agent-name>/
            └── MEMORY.md
```

## Global directory structure (~/)

```
~/
├── .claude.json                       # App state, OAuth, UI toggles, personal MCP servers (local)
└── .claude/
    ├── CLAUDE.md                      # Personal preferences across every project (local)
    ├── settings.json                  # Default settings for all projects (local)
    ├── keybindings.json               # Custom keyboard shortcuts (local)
    ├── rules/                         # User-level rules for every project (local)
    ├── skills/                        # Personal skills available in every project (local)
    ├── commands/                      # Personal commands available in every project (local)
    ├── output-styles/                 # Personal output styles (local)
    ├── agents/                        # Personal subagents available in every project (local)
    ├── agent-memory/                  # Persistent memory for subagents with memory: user (local)
    └── projects/                      # Auto memory: Claude's notes to itself, per project (local)
        └── <project>/memory/
            ├── MEMORY.md              # Index loaded at session start (first 200 lines / 25KB)
            └── debugging.md           # Topic files read on demand
```

## Key files explained

### CLAUDE.md
- **Scope**: Project and global
- **When**: Loaded into context at the start of every session
- **Purpose**: Project-specific instructions that shape how Claude works. Conventions, common commands, architectural context.
- **Tips**: Target under 200 lines. If something only matters for specific tasks, move it to a skill or path-scoped rule.

### .mcp.json
- **Scope**: Project only (committed)
- **When**: Servers connect when the session begins. Tool schemas are deferred by default and load on demand via tool search.
- **Purpose**: Configures MCP servers that give Claude access to external tools: databases, APIs, browsers. Personal servers go in `~/.claude.json` instead.

### settings.json
- **Scope**: Project and global (committed)
- **When**: Overrides global `~/.claude/settings.json`. Local settings, CLI flags, and managed settings override this.
- **Purpose**: Permissions, hooks, environment variables, model defaults. Unlike CLAUDE.md (guidance), these are enforced.
- **Contains**: permissions (allow/deny/prompt), hooks (pre/post tool events), statusLine, model, env, outputStyle

### settings.local.json
- **Scope**: Project only (gitignored)
- **Purpose**: Personal settings that take precedence over project defaults. Same JSON format as settings.json.

### rules/
- **Scope**: Project and global (committed)
- **When**: Rules without `paths:` load at session start. Rules with `paths:` load when a matching file enters context.
- **Purpose**: Instructions split into topic files that can load conditionally based on file paths.

### skills/
- **Scope**: Project and global (committed)
- **When**: Invoked with `/skill-name` or when Claude matches the task to a skill.
- **Purpose**: Each skill is a folder with SKILL.md plus supporting files. Both user and Claude can invoke by default.

### agents/
- **Scope**: Project and global (committed)
- **When**: Runs in its own context window when you or Claude invoke it.
- **Purpose**: Each markdown file defines a subagent with its own system prompt, tool access, and optionally its own model. Subagents run in a fresh context window, keeping the main conversation clean.

### agent-memory/
- **Scope**: Project (committed) or user-level
- **When**: First 200 lines (capped at 25KB) of MEMORY.md loaded into the subagent system prompt when it runs.
- **Purpose**: Subagents with `memory: project` in their frontmatter get a dedicated memory directory. Distinct from main session auto memory.
- **Memory scopes**: `memory: project` → `.claude/agent-memory/` (committed), `memory: local` → `.claude/agent-memory-local/` (gitignored), `memory: user` → `~/.claude/agent-memory/` (global)

### Auto memory (projects/)
- **Scope**: Global only (`~/.claude/projects/<project>/memory/`)
- **When**: MEMORY.md loaded at session start; topic files read on demand.
- **Purpose**: Claude accumulates knowledge across sessions. Claude saves notes as it works: build commands, debugging insights, architecture notes.
- **Behavior**: On by default. MEMORY.md is the index (first 200 lines / 25KB). Topic files are read on demand.

## Choose the right file

| You want to                                        | Edit                                     | Scope             |
| :------------------------------------------------- | :--------------------------------------- | :---------------- |
| Give Claude project context and conventions        | `CLAUDE.md`                              | project or global |
| Allow or block specific tool calls                 | `settings.json` `permissions` or `hooks` | project or global |
| Run a script before or after tool calls            | `settings.json` `hooks`                  | project or global |
| Set environment variables for the session          | `settings.json` `env`                    | project or global |
| Keep personal overrides out of git                 | `settings.local.json`                    | project only      |
| Add a prompt or capability you invoke with `/name` | `skills/<name>/SKILL.md`                 | project or global |
| Define a specialized subagent with its own tools   | `agents/*.md`                            | project or global |
| Connect external tools over MCP                    | `.mcp.json`                              | project only      |
| Change how Claude formats responses                | `output-styles/*.md`                     | project or global |

## Application data

Beyond config you author, `~/.claude` holds data Claude Code writes during sessions. These are plaintext.

### Cleaned up automatically (default: 30 days)

| Path under `~/.claude/`                      | Contents                                                    |
| -------------------------------------------- | ----------------------------------------------------------- |
| `projects/<project>/<session>.jsonl`         | Full conversation transcript: every message, tool call      |
| `projects/<project>/<session>/tool-results/` | Large tool outputs spilled to separate files                |
| `file-history/<session>/`                    | Pre-edit snapshots for checkpoint restore                   |
| `plans/`                                     | Plan files written during plan mode                         |
| `debug/`                                     | Per-session debug logs (when started with --debug)          |

### Kept until you delete them

| Path under `~/.claude/` | Contents                                          |
| ----------------------- | ------------------------------------------------- |
| `history.jsonl`         | Every prompt typed, with timestamp and project     |
| `stats-cache.json`      | Aggregated token and cost counts shown by `/cost` |

---

*Source: https://code.claude.com/docs/en/claude-directory.md*
