# Agent Trail — Product Requirements Document

> An open interchange format and tooling ecosystem for coding agent sessions.

| | |
|---|---|
| **Author** | Somasundaram |
| **Status** | Draft |
| **Date** | 2026-05-18 |
| **Companion docs** | `../spec.md`, `../schema.json` |

---

## Document notes

- The repo keeps the public contract files at the root: `spec.md` and `schema.json`.
- Product planning lives in `docs/PRD.md`; repo-wide terminology lives in `CONTEXT.md`.
- Public releases publish immutable versioned snapshots at URLs such as `/spec/v0.1.0` and `/schema/v0.1.0.json`.
- Product requirements are not semver-versioned; the spec/schema carry the interoperability version.
- The project should live in one Bun-based open-source monorepo containing the spec, schema, adapters, CLI, redaction tooling, website, and future packages.

---

## 1. Executive summary

Coding agent sessions are fragmented across ~20 tools (Claude Code, Cursor, Codex CLI, Pi, Aider, etc.), each with its own storage format. Solutions discovered in one agent are invisible from another. Sessions can't be cleanly shared, reviewed, archived, or analyzed across tools.

Agent Trail is an **open spec, OSS adapter library, CLI, MCP server, and web viewer** that normalize coding agent sessions to a single canonical format. The position is horizontal infrastructure — a format other tools adopt — not a vertical product competing with existing agents or session managers.

**Strategic frame:** "Pandoc for coding agent sessions." The spec is the moat; tools are proof points; products built on top can use Agent Trail as one component without changing the project's open-source scope.

---

## 2. Problem statement

### 2.1 The user-side pain

A developer using multiple coding agents loses knowledge between them. Concrete examples:

- "I solved this exact bug in Cursor three weeks ago — where's the conversation?"
- "Claude Code subagents found something useful in a parallel session — can I reference it from Pi?"
- "I want to share this great debugging session with my team — Slack? Screenshot? A 200-line paste of JSONL?"
- "Our company uses 4 different agents across the team — there's no consolidated record of what's been tried."

### 2.2 The ecosystem-side pain

- Each new sharing tool reimplements the same primitives (adapter, viewer, redactor) per agent.
- No common substrate for downstream products: training data, audit logs, team knowledge bases, evaluation harnesses.
- Tools that *could* interoperate (e.g., agent-to-agent handoff) have no shared protocol for "this is the context."
- Existing projects (cass, claudereview, pi-share, agenttrace, pi-session-manager, hwisu/opensession) each solve a slice with their own canonical format. **None have proposed a format others can adopt.**

### 2.3 Why now

- Coding agent landscape went from one (Claude Code) to twenty in 18 months.
- MCP ecosystem standardized tool calls but not session representations.
- The window to set the standard is open and short — at least one competing implementation (hwisu/opensession) is shipping but has not pursued spec-first adoption.
- Pi has built session sharing — user appetite is demonstrated.

### 2.4 Evidence

- cass exists and parses 19 agents — proves demand for cross-agent visibility.
- Pi has `/share` + web viewer — proves user appetite for sharing.
- pi-share-hf, ccshare, Claudebin, sharemyclaude, claude-code-share all exist for individual agents — proves repeat-build pattern.
- hwisu/opensession has shipped a sophisticated vertical product — proves the technical lift is feasible.
- Anthropic has an open feature request for native Claude Code session sharing.

---

## 3. Vision & strategic positioning

### 3.1 12-18 month vision

A developer running Claude Code can run `trail share` and get a URL. The URL renders in a generic web viewer that works equally well for Pi sessions, Cursor sessions, or Aider sessions shared the same way. A teammate using Cursor can `trail load <url>` and have the session imported as context. A senior engineer reviewing a junior's work runs `trail view`, sees the same tool calls and file diffs regardless of which agent produced them. A research team analyzes 10,000 anonymized sessions across agents to study how engineers prompt.

This works because Agent Trail is the file format the ecosystem adopted. Sharing tools (Claudebin, claudereview, hwisu/opensession, etc.) write trail files. Editors (VS Code extension, Tauri app) read them. Storage tools (cass) index them. The format is to coding-agent sessions what Markdown is to documents.

### 3.2 Strategic positioning: horizontal, not vertical

Agent Trail is **infrastructure under existing tools**, not a competitor to them. Key implications:

| Lever | Vertical product (e.g., opensession) | Horizontal format (Agent Trail) |
|---|---|---|
| Success metric | DAU / MAU of own app | Adoption by other tools |
| Adoption story | "Use OpenSession instead" | "Adopt this format; keep your tool" |
| Audience | End users of session managers | Tool builders + power users |
| Defensibility | Network effects in own app | Format becoming the default |

The vertical play is harder because it requires displacing incumbents. The horizontal play is easier because it requires being adopted alongside incumbents.

### 3.3 Metaphor selection

Three working metaphors; pick one for marketing:

| Metaphor | What it captures | When it works |
|---|---|---|
| **Pandoc for coding sessions** | Format-conversion tooling | Pitch to tool builders |
| **Markdown for AI conversations** | Lossy, opinionated, adoptable | Pitch to engineers |
| **Git for sessions** | Branching, sharing, content addressing | Pitch to power users |

### 3.4 Why open source first

- Format wins by adoption, not declaration. Closed format = no adoption.
- The audience is engineers who self-select for OSS-friendly tools.
- Competitors (Claudebin, claudereview, opensession, etc.) could become adopters if the spec is good. AGPL would kill that.
- Agent Trail remains fully open source. Separate products may build on top of the format, but they are outside this project's scope.

### 3.5 Core design principles

1. **Lossy-but-semantic.** Like Markdown: not every source detail survives, but what does is portable and meaningful.
2. **Content-addressable.** Finalized artifacts are identified by SHA-256 of canonical bytes (see spec §7.3). Enables dedup and tamper-evidence. V1 sharing URLs are gist-locating; hash lookup is deferred until a resolver exists.
3. **No proprietary URI scheme.** Files are files; locations are conventional. Tools adopt the format without buying into our URL space.
4. **Honest about lossiness.** Adapters flag synthesized events with `source.synthesized: true`. Users see when reconstruction occurred.
5. **Reader-tolerant.** Unknown event types preserved and rendered with fallback, not rejected.
6. **No daemon required.** Manual share by default; auto-capture is a future opt-in, not a foundation requirement.

### 3.6 Licensing decisions

| Component | License | Reasoning |
|---|---|---|
| Spec (`spec.md`) | Apache-2.0 | Permissive with patent grant; adoption-friendly for companies |
| JSON Schema (`schema.json`) | Apache-2.0 | Same |
| Schema package (`@agent-trail/schema`) | Apache-2.0 | Publishes the spec/schema contract |
| Product docs (`docs/PRD.md`, `CONTEXT.md`, `docs/`) | Apache-2.0 unless otherwise noted | Keeps project documentation aligned with the spec license |
| Adapter library | MIT | Friction-free for any consumer |
| CLI tool | MIT | Same |
| Web viewer | MIT | Same |
| MCP server | MIT | Same |

The repository root `LICENSE` should be Apache-2.0 so GitHub displays the spec/schema license clearly. Add a root `LICENSES.md` (or `NOTICE`) that documents the mixed-license layout:

- `spec.md`, `schema.json`, and `packages/schema/`: Apache-2.0.
- Implementation packages such as `packages/core/`, `packages/types/`, `packages/adapters/`, `packages/redact/`, `packages/cli/`, and `apps/website/`: MIT.
- Product and project documentation: Apache-2.0 unless otherwise noted.

Each published package must also declare its own license in `package.json`: `@agent-trail/schema` uses `Apache-2.0`; implementation packages use `MIT`.

### 3.7 Naming conventions

Locked-in names across all surfaces:

| Concept | Name | Notes |
|---|---|---|
| Format / project | **Agent Trail** | Capitalized in prose, titles, marketing |
| URL / slug form | **agent-trail** | Lowercase, hyphenated |
| File extension | **`.trail.jsonl`** | JSON highlighting via the `.jsonl` suffix |
| MIME type | **`application/vnd.trail+jsonl`** | IETF-conformant `vnd.` prefix |
| CLI command | **`trail`** | What users type 100 times a day |
| GitHub org | **`agent-trail`** | Registered; `github.com/agent-trail/<repo>` |
| GitHub repo | **`agent-trail`** | Single OSS monorepo: `github.com/agent-trail/agent-trail` |
| npm scope | **`@agent-trail`** | Matches the GitHub org and project slug; registered on npm |
| Package manager/runtime | **Bun** | Bun workspaces for repo scripts, tests, and packages |
| Domain | **`agent-trail.dev`** | Pending availability check |
| Reverse-domain prefix | **`dev.agent-trail.*`** | For vendor extensions in `metadata` fields |
| Spec doc filename | **`spec.md`** | Stable repo filename; releases publish immutable versioned snapshots |
| JSON Schema filename | **`schema.json`** | Same |
| In prose: "the spec" | OK informally | When context makes it clear |
| In prose: "the trail file" | OK | "I shared a trail file" reads naturally |
| In prose: "the trail" | Avoid | Ambiguous with the hiking term |

The lowercase/uppercase split mirrors Pandoc (the project) vs `pandoc` (the binary) — standard convention.

---

## 4. Non-goals

Explicitly out of scope to keep focus:

- **Replacing agents' native formats.** Adapters convert; they don't replace.
- **Real-time bidirectional sync between agents.** Sharing is async snapshot-based.
- **Being a coding agent.** We don't compete with Claude Code, Cursor, or Pi.
- **Being a vertical session-management product.** Don't compete with hwisu/opensession on its own ground.
- **Service product requirements.** Agent Trail is the open format and tooling layer. Products using it are separate.
- **Auto-capture daemon (v0-v1).** Manual share is the v1 surface; auto-capture deferred.
- **Interview / hiring tools.** Possible adjacent market later, but not a v1 product surface.
- **Mobile clients.** Web viewer is mobile-responsive; native mobile app not on the roadmap.

---

## 5. Target users

### 5.1 Primary user: the cross-tool engineer

**Profile:** Software engineer with 3+ years experience who uses 2+ coding agents regularly. Self-hosts some tooling. Active on HN, follows AI tooling closely.

**Jobs-to-be-done:**
- Find that bug fix I worked on weeks ago, regardless of which agent helped.
- Share a noteworthy session with a teammate or publicly.
- Move context between agents when one is better suited for a subtask.
- Review my own session history for patterns ("how often do I hit this kind of bug?").

**Pain today:** Manual scrolling through JSONL files. Different UIs per agent. Copy-paste between agents is lossy. No way to share Pi sessions to a Cursor user without losing tool call structure.

**Where they hang out:** HN, X/Twitter (AI engineer community), Discord, r/LocalLLaMA, individual agent communities.

### 5.2 Secondary user: the tool builder

**Profile:** People building products in this space — Pi maintainers, Claudebin team, claudereview, cass, hwisu/opensession, future entrants.

**Jobs-to-be-done:**
- Read/write a session format without writing 19 adapters.
- Interoperate with other tools without per-tool integration.
- Have a stable target to build features against (review tools, analytics, audit, etc.).

**Pain today:** Every new tool reimplements adapters. No interop. Format choices are locally rational but globally fragmented.

**This is the MOST IMPORTANT user.** A single tool-builder adoption brings hundreds of end-users. The PRD optimizes for tool-builder adoption first, end-user features second.

### 5.3 Tertiary user: the team lead / hiring manager

**Profile:** Eng lead at 10-100 person company. Has 2+ engineers using different coding agents. Wants visibility into how AI is being used without dictating tooling.

**Jobs-to-be-done:**
- Audit how agents are being used on company codebases.
- Review session quality during onboarding or code review.
- Build internal knowledge base of "good agent sessions" for training new hires.

**Pain today:** Zero visibility unless they pick a single tool and mandate it. Most teams won't.

---

## 6. Use cases / user stories

| # | User | Story | Acceptance |
|---|---|---|---|
| U1 | Cross-tool engineer | "Share my Claude Code session with a colleague who uses Pi" | `trail share <id>` produces URL; colleague opens it in browser and sees rendered session |
| U2 | Cross-tool engineer | "Find a session from last month where I debugged a race condition" | `trail list --search "race condition"` returns matches across all agents |
| U3 | Cross-tool engineer | "Load context from my Cursor session into my Aider session" | `trail load <url>` fetches and validates the trail; `trail export --format primer` produces a context primer suitable for Aider's prompt |
| U4 | Team lead | "See what sessions my team ran this sprint" | Shared index (self-hosted) shows sessions filtered by date, author, project |
| U5 | Tool builder | "Add Agent Trail export to my agent" | Adapter SDK; <100 lines of code per agent |
| U6 | Cross-tool engineer | "Share a session publicly on Twitter without leaking API keys" | Redaction pipeline runs by default; user confirms before share |
| U7 | Cross-tool engineer | "View a Pi session that has branches" | Web viewer renders linear path; surfaces abandoned branches as notice |
| U8 | Cross-tool engineer | "Search my own sessions from inside Claude Code" | Deferred MCP server exposes `search_sessions`, `load_session`; Claude Code can call it after the v1 CLI/viewer launch |
| U9 | Cross-tool engineer | "Set up Agent Trail for the first time" | `trail doctor` diagnoses; `trail doctor --fix` configures; zero-config works for default install locations |
| U10 | Team lead | "Add session review to our PR workflow" | GitHub Action posts session-digest comment when PR description references a trail URL |

---

## 7. Product surface

Core components, with MCP and desktop deferred:

### 7.1 The spec and schema package (shipped: v0.1.0 draft)

- `spec.md` — human-readable spec, edited in-repo under a stable filename.
- `schema.json` — canonical writer-strict JSON Schema and format contract, edited in-repo under a stable filename.
- Hosted releases publish immutable snapshots such as `https://agent-trail.dev/spec/v0.1.0` and `https://agent-trail.dev/schema/v0.1.0.json` (see §7.5).
- Local filenames are unversioned; public release URLs are versioned, with explicit migration policy.
- `@agent-trail/schema` publishes the same schema to npm for tooling consumers. It exposes the current schema as the default/latest export and explicit versioned exports such as `@agent-trail/schema/v0.1.0`.

### 7.2 Parser Source Matrix

A living document (`docs/parser-source-matrix.md`) inside the repo. For each supported agent:

- Source status (open vs closed-source)
- Storage format(s) observed (verified empirically)
- Reuse boundary (re-implement vs reference; legal considerations)
- Primary reference URLs
- Verification date and source-agent package version
- Real entry types observed in actual data
- Test fixture names locking the behavior

This is documentation hygiene that pays compounding dividends. Modeled after hwisu/opensession's [parser-source-matrix.md](https://github.com/hwisu/opensession/blob/main/docs/parser-source-matrix.md).

### 7.3 Adapter library (`@agent-trail/adapters`)

- TypeScript package, MIT.
- Exports per-agent adapter functions: `parseClaudeCode(file): TrailFile`, `parsePi(...)`, etc.
- Each adapter implements a common interface (see §8.2).
- Discovers sessions in standard locations (`~/.claude/projects/...`, `~/.pi/agent/sessions/...`, etc.).
- Six adapters at v1 launch: Pi, Claude Code, Codex CLI, Cursor, Gemini CLI, Aider.

### 7.4 CLI tool (`trail`)

- `trail doctor` / `trail doctor --fix` — diagnose and configure environment.
- `trail list` — list all sessions across configured agents.
- `trail view <id>` — render a session to terminal.
- `trail register <file>` — parse + canonicalize + store locally (content-addressed).
- `trail share <id>` — redact, upload to gist, return URL.
- `trail load <url>` — fetch and decode a shared session.
- `trail export <id> --format <html|md|jsonl>` — local export.
- `trail validate <file>` — validate against schema.

### 7.5 Website (`agent-trail.dev`)

Single domain with four routes. The site follows the **TOML-style hybrid model**: a light landing page that orients new visitors, plus versioned spec hosting, schema hosting, and the viewer. No blog, no docs hierarchy, no marketing surfaces. See §8.4 for detailed requirements and §16 for explicit non-goals.

| Route | Purpose |
|---|---|
| `/` | Landing page: short hook, example trail file, supported-adapters list, links to spec and GitHub |
| `/spec/v0.1.0` | Full spec rendered as HTML (immutable release snapshot) |
| `/schema/v0.1.0.json` | JSON Schema served as JSON (immutable release snapshot) |
| `/view/gist/<gist-id>` | Web viewer for gist-backed shared sessions |

Site precedent: TOML (`toml.io`) is the closest model — light landing + versioned spec pages, no marketing/blog/learn. Agent Trace (`agent-trace.dev`) is a stricter version (pure spec page, no landing).

### 7.6 MCP server (`@agent-trail/mcp`, deferred)

- Local MCP server users add to their agent's MCP config.
- Tools exposed:
  - `share_session(session_id)` → URL
  - `load_session(url)` → trail content
  - `list_local_sessions(filters)` → array of session metadata
  - `search_sessions(query)` → ranked results
- Enables agents to access Agent Trail without leaving their UI.
- Deferred out of Phase 1 so the initial launch can focus on six adapters, validation, sharing, and the web viewer.

### 7.7 Desktop app (`Tauri`, future)

- Cross-platform desktop viewer.
- Reuses the web viewer's renderer as an embedded component.
- Adds: local indexing, search, file system watcher, bulk operations.
- Not in v1 scope.

### 7.8 Products built on Agent Trail (out of scope)

- Separate products may use Agent Trail as a component.
- This project does not define service-side storage, authentication, or team-product workflows.
- Product-specific requirements belong outside this PRD.

---

## 8. Detailed requirements

### 8.1 Spec (already in v0.1.0)

See `../spec.md`. Open items tracked in §19 of that doc.

### 8.2 Adapter library

**Common adapter interface:**

```ts
export interface TrailAdapter {
  readonly name: string;                          // canonical agent name
  detectSessions(opts?: DetectOptions): Promise<SessionRef[]>;
  parseSession(ref: SessionRef): Promise<TrailFile>;
  isAvailable(): Promise<boolean>;                // checks if agent's storage exists
  sourceVersion(): Promise<string | null>;        // detected source agent version
}
```

**v1 launch adapters** (in priority order):

1. **Pi** — direct mapping, baseline fidelity reference.
2. **Claude Code** — highest user volume.
3. **Codex CLI** — second-highest volume; OpenAI users.
4. **Cursor** — SQLite extraction; expands beyond CLI tools.
5. **Gemini CLI** — third major model family.
6. **Aider** — special handling (synthesized events from git diffs).

**Adapter quality requirements:**

- Each adapter must validate its output against the JSON Schema in tests via `validateAdapterTrail` from `@agent-trail/adapters`, which wraps the writer-strict validator from `@agent-trail/core`.
- Each adapter must have at least 3 synthetic or redacted fixture sessions checked in as test cases.
- Each adapter must be locked to a specific source-agent package version in its test setup; tests document which version was verified.
- Tests must run real local-session fixtures (`--ignored` style, opt-in) to catch silent schema drift. Real sessions must not be committed.
- The Parser Source Matrix doc must be updated whenever a new source-agent version is verified.
- File operations must round-trip when source has structured representations.
- Aider adapter must emit `source.synthesized: true` for git-derived events.
- Adapters MUST populate `semantic.call_id` on tool_call/tool_result pairs when source has its own IDs (especially Claude Code's `tool_use_id`, which can be null).

**Out of scope for v1:** Amp, Cline, OpenCode, ChatGPT, Copilot variants, Crush, Kimi, Qwen, Factory, Vibe, OpenClaw, Clawdbot. Community contributions welcomed via PR after spec is stable.

### 8.3 CLI

The first implementation milestone exposes only `trail validate`. The rest of the v1 command surface lands after core validation and the initial adapters are reliable.

**Initial command surface:**

```
trail validate <file> [--json] [--profile strict|reader-tolerant]
```

`trail validate` defaults to writer-strict validation against the current schema and whole-file rules. It returns non-zero when any error is present. A present but incorrect `content_hash` is an error in strict validation.

**Command surface (v1):**

```
trail doctor [--fix] [--yes]
trail list [--agent <name>] [--cwd <path>] [--since <date>] [--search <query>]
trail view <id-or-path> [--format text|json] [--full]
trail register <file>
trail share <id> [--public] [--dry-run] [--skip-redaction]
trail load <url> [--out <path>]
trail export <id> --format html|md|jsonl|primer [--out <path>] [--target <agent>] [--max-tokens <n>]
trail validate <file>
trail adapters list
trail adapters status
```

**`trail doctor` behavior:**

- Check mode (default): inspects environment, prints diagnosis (similar to `flutter doctor`):
  - Is each adapter's source agent detected?
  - Are storage paths readable?
  - Is `gh` CLI installed (required for `share`)?
  - Is MCP server config writable? (future/deferred)
  - Are secret-list files in place (`~/.config/trail/secrets.txt`)?
- Fix mode (`--fix`): applies recommended setup with explicit confirmation. Use `--yes` for non-interactive mode.

**Cross-cutting requirements:**

- Standalone binary distribution via `bun build --compile`, published per-platform to GitHub Releases, Homebrew, and an install script. End users install zero JavaScript runtime.
- The CLI source is Bun-only (Bun ≥ 1.3.11) and uses Bun-native APIs; library packages it depends on remain Node 20+ and Bun compatible. See ADR-0003.
- No required runtime config; works zero-conf for users with default agent install locations.
- Optional config file at `~/.config/trail/config.json` for custom paths, secret lists, etc.
- All commands support `--json` for scripting.
- Exit codes: 0 success, 1 user error, 2 system error, 3 redaction blocked.
- `trail load <url>` fetches, verifies, and stores or writes a trail artifact. It does not summarize by default.
- `trail export --format primer` renders an agent-handoff primer with explicit target-agent and token-budget options.

**Validation diagnostics:**

All validator APIs and `trail validate --json` return normalized diagnostics with: `line`, `path` (JSON Pointer), `severity`, `code`, and `message`.

**Core validation APIs:**

`@agent-trail/core` exposes layered validation primitives: streaming JSONL parsing, writer-line validation, whole-file graph checks, hash verification, and reader-tolerant parsing. The parser foundation is streaming-first; convenience in-memory wrappers may layer on top.

**Local store contract:**

- Store root defaults to `~/.local/share/trail`.
- Finalized trail artifacts are stored content-addressed under `objects/sha256/<hash>.trail.jsonl`.
- Mutable references and search metadata live under `index/` and may be rebuilt from stored objects.
- `trail register` canonicalizes, validates, hashes, stores the artifact, and updates the local index.
- Files with omitted or `"<pending>"` `content_hash` may be indexed as source refs but are not stored as finalized objects until hashed.

**Redaction pipeline (mandatory, see §8.6):**

- Runs by default on `trail share`.
- `--skip-redaction` flag exists but prints a loud warning and requires confirmation.
- `--dry-run` shows what would be redacted/uploaded without uploading.

### 8.4 Website (`agent-trail.dev`)

The site is one Next.js static deployment with four routes. Single deployment, single repo, single CI pipeline.

#### 8.4.1 Landing page (`/`)

Short, oriented, no marketing fluff. Target word count: ~300 words plus a code block. Content elements, top to bottom:

1. **Title and one-line hook.** "Agent Trail — open format for coding agent sessions."
2. **Two-sentence motivation.** Pulled from spec §1 verbatim. Don't rewrite it for the site.
3. **Small example trail file.** 6-8 lines of JSONL showing the format in action. Syntax-highlighted.
4. **Supported adapters list.** Auto-generated from the monorepo's adapter packages. Each item shows: agent name, source-agent version verified against, link to the adapter source.
5. **Links to spec versions.** Latest version first, older versions in a collapsed list.
6. **Get involved.** Links to the GitHub monorepo and, later, a community channel if one exists.

What the landing page **does not** contain:
- Hero section with gradient background or animations.
- Value-proposition bullets ("Save time! Move faster!").
- Customer logos or testimonials.
- Calls-to-action like "Get Started Free" or "Try It Now."
- Newsletter signup.
- Comparison tables ranking us against competitors.

#### 8.4.2 Spec hosting (`/spec/<version>`)

Each spec version gets a permanent URL:

- `/spec/v0.1.0` — current at time of writing.
- `/spec/latest` → redirects to current version.
- `/spec/` (no version) → redirects to `/spec/latest`.

Each spec page renders the spec markdown as semantic HTML with:
- Anchor links on every heading (linkable sections).
- Syntax highlighting in code blocks via shiki.
- A small persistent header bar: `Agent Trail | Spec | GitHub | Viewer`.
- Sidebar TOC (optional; can defer to v1.1).
- Footer with version, status, license.

Spec versions are **never overwritten**. Adopters who link to `/spec/v0.1.0` get the exact text they read, forever.

Release policy follows `../spec.md` §6: SemVer for the interoperability contract, no version bump for purely editorial changes, patch for clarifications, minor for backward-compatible additions, and major for breaking changes after `1.0.0`. Before `1.0.0`, any unavoidable breaking change must be called out explicitly in the changelog.

#### 8.4.3 Schema hosting (`/schema/<version>.json`)

Raw JSON Schema files served with `Content-Type: application/schema+json`. Same versioning policy as spec — never overwritten, latest gets an alias.

- `/schema/v0.1.0.json`
- `/schema/latest.json` → redirects or serves current

This is the URL referenced by the schema's `$id` field. Tools validating trail files fetch from here.

#### 8.4.4 Web viewer (`/view/gist/<gist-id>`)

Accepts a gist identifier or gist URL. Decodes embedded gzipped base64 trail content. The gist ID locates the artifact; `content_hash` verifies fetched bytes after load. Content-hash resolver URLs such as `/view/sha256/<hash>` are deferred until there is a backend or public index. Renders:

- User messages (chat bubbles, markdown rendered).
- Agent messages (markdown, code blocks syntax-highlighted).
- Tool calls (collapsible cards, tool-kind specific layouts).
- Tool results (output, truncation warnings, expandable).
- File diffs (unified diff renderer with syntax highlighting).
- `branch_summary` events as inline callouts.
- `session_terminated` as warning banner.
- Unknown event types as generic boxes.

For tree sessions, render path from leaf to root. Surface "this session has N abandoned branches" as a notice. Display session metadata (agent, model, duration, working dir).

Verify `content_hash` if present; warn on mismatch.

**Non-functional:**

- Static site, no backend. Hosted on Vercel/Cloudflare Pages.
- Cold-load TTI < 2s on average connection.
- Works offline if session is cached in service worker.
- Lighthouse score >90 mobile.

**Out of scope for v1:**

- Tree view UI (deferred to v1.1).
- Comparison view (compare two sessions).
- Authentication / private server-backed sessions.
- Real-time updates / streaming display.

### 8.5 MCP server (deferred)

**Tool surface:**

| Tool | Args | Returns |
|---|---|---|
| `share_session` | `{ session_id, public? }` | `{ url }` |
| `load_session` | `{ url }` | `{ content: TrailFile }` |
| `list_local_sessions` | `{ agent?, since?, search? }` | `{ sessions: [{ id, agent, cwd, ts, preview }] }` |
| `search_sessions` | `{ query, limit? }` | `{ results: [{ id, snippet, score }] }` |

**Installation:**

- `npm install -g @agent-trail/mcp` or via the CLI: `trail mcp install`.
- Adds entry to user's MCP config (Claude Code, Cursor, etc.).
- Each agent surface gets a one-command install path.

### 8.6 Redaction module (`@agent-trail/redact`)

Standalone TS package usable by CLI and any adapter.

**Pipeline (in order):**

1. **Adapter-specific pre-clean** — each adapter calls redactor with hotspot patterns relevant to its source (e.g., MCP headers, env-var echoes).
2. **User-supplied exact secrets** — read from `~/.config/trail/secrets.txt`; exact-match replacement.
3. **Path normalization** — `/Users/<name>/...` → `/Users/<user>/...`; home dir → `<home>`.
4. **PII via `@redactpii/node`** — emails, phones, SSNs, credit cards, names.
5. **Curated API key patterns** — AWS, OpenAI, Anthropic, GitHub, Stripe, Slack, Google, JWT, SSH keys, Bearer headers, `.env`-style assignments (~30 patterns).
6. **Output truncation** — tool outputs >10KB truncated with reference.
7. **Confirmation UI** — terminal preview showing redaction count, sample lines, prompt for confirm.

**Threat model:**

- Assets: API keys, credentials, PII, internal paths, proprietary source/output, and sensitive project data embedded in messages or tool output.
- Adversary: anyone who receives or guesses an unlisted gist URL, plus any infrastructure that can read gist contents.
- Trust boundary: GitHub unlisted/private gists are URL-accessible sharing artifacts, not end-to-end private storage controlled by Agent Trail.
- Redaction is best-effort deterministic protection. Users must confirm the preview before upload; public sharing should be treated as irreversible disclosure risk.
- Raw local trail artifacts preserve fidelity. Shared trail artifacts are separate redacted artifacts with their own `content_hash`.

**Deferred to public-sharing mode (post-v1):**

- TruffleHog scan (Go binary, opt-in).
- LLM review for topic + missed sensitive content.

### 8.7 Sharing transport

**v1: GitHub gist (only).**

- `gh gist create --public=false` for unlisted/private-by-URL gists. The CLI must warn that anyone with the URL can read the content.
- Single-file gist containing base64-encoded gzipped trail JSONL.
- Renderer at `agent-trail.dev/view/gist/<gist-id>` fetches and decodes.
- Reuses Pi's pattern; zero hosting cost.
- `content_hash` is used to verify the fetched artifact. Content-hash-addressed lookup is deferred until a resolver or index exists.

**Deferred:**

- Self-hosted index service.
- S3 / R2 storage option.
- Git-native (hidden refs) transport. (hwisu/opensession's territory; not where we add value)
- HF dataset upload (with full pi-share-hf-style pipeline).

---

## 9. Repository and package layout

Agent Trail uses a single Bun-based monorepo. The repository root contains the normative contract files (`spec.md`, `schema.json`) plus workspace packages for implementation code, while product planning lives under `docs/`. Keeping the spec and tooling together is intentional for the pre-1.0 phase: schema changes, generated types, validators, fixtures, adapters, website rendering, and compatibility tests should move in one reviewable change.

`schema.json` is the canonical format contract through v1.0. TypeScript types and validators are generated from the schema, and generated TypeScript outputs are committed so schema changes produce reviewable diffs.

Initial repository shape:

```text
.
|-- README.md
|-- LICENSE
|-- LICENSES.md
|-- spec.md
|-- schema.json
|-- package.json
|-- bun.lock
|-- docs/
|   |-- PRD.md
|   |-- parser-source-matrix.md
|   `-- mappings/
|-- packages/
|   |-- schema/
|   |-- types/
|   |-- core/
|   |-- adapters/
|   |-- redact/
|   `-- cli/
`-- apps/
    `-- website/
```

The root `package.json` uses Bun workspaces. Package publishing remains under the `@agent-trail` npm scope:

| Package | Purpose | Status |
|---|---|---|
| `@agent-trail/schema` | Published JSON Schema with latest/default and versioned exports | v1 |
| `@agent-trail/types` | Committed TS types generated from JSON Schema | v1 |
| `@agent-trail/core` | Shared utilities (hashing, canonicalization, validation) | v1 |
| `@agent-trail/adapters` | Multi-agent parser library | v1 |
| `@agent-trail/redact` | Redaction pipeline | v1 |
| `@agent-trail/cli` | The `trail` binary | v1 |
| `@agent-trail/mcp` | MCP server | future |
| `@agent-trail/website` | Website app for `agent-trail.dev` (landing + spec + schema + viewer) | v1 |
| `@agent-trail/desktop` | Tauri desktop app | future |

All published JavaScript packages are ESM-only, support Node 20+ and Bun, and use independent package SemVer. Packages declare the Agent Trail spec versions they support instead of matching npm package versions to spec versions.

Python support is deferred until the TypeScript implementation and public schema contract are stable.

Install ergonomics:

```
npm install -g @agent-trail/cli      # installs the `trail` binary
npm install @agent-trail/schema      # for raw schema consumers
npm install @agent-trail/adapters    # for tool builders
```

---

## 10. Phased roadmap

Honest weeks-of-effort estimates for a single developer working evenings/weekends.

### 10.1 Phase 0 — Foundation (weeks 1-4)

**Goal:** Contract-first implementation: schema package, generated types, core validation, and `trail validate`.

| Deliverable | Effort | Status |
|---|---|---|
| Spec v0.1.0 draft (`spec.md`) | done | ✅ |
| JSON Schema v0.1.0 draft (`schema.json`) | done | ✅ |
| GitHub monorepo set up (`agent-trail/agent-trail`) | 1 day | not started |
| Bun workspace scaffold in the monorepo | 1 day | not started |
| `@agent-trail/schema` — npm package with latest and v0.1.0 exports | 1 day | not started |
| `@agent-trail/types` — committed TS types generated from schema | 1 day | not started |
| `@agent-trail/core` — streaming JSONL parser and layered validation APIs | 3 days | not started |
| `@agent-trail/cli` — `trail validate` with text and `--json` output | 2 days | not started |
| Synthetic validation fixtures | 1 day | not started |
| README + getting started | 1 day | not started |

**Phase 0 exit criteria:**

- `@agent-trail/schema` publishes the v0.1.0 schema and exposes explicit versioned exports.
- Generated TypeScript types are committed and checked against `schema.json`.
- `@agent-trail/core` can stream-parse JSONL, validate writer-strict records, run whole-file checks, and verify `content_hash`.
- `trail validate <file>` runs strict validation by default and supports structured `--json` diagnostics.
- Tests passing in CI with committed synthetic/redacted fixtures.

### 10.2 Phase 1 — Public launch (weeks 5-24)

**Goal:** Six adapters, sharing works end-to-end, website ships (landing + spec hosting + viewer), public announcement. This phase intentionally keeps all six launch adapters as the proof target and defers MCP to protect adapter quality.

| Deliverable | Effort | Notes |
|---|---|---|
| Adapters: Codex CLI, Cursor, Gemini CLI, Aider | 6-8 weeks | Aider requires storage verification before final mapping |
| `@agent-trail/redact` module + integration with CLI | 1 week | `@redactpii/node` + curated patterns |
| `trail register` + `trail share` (gist transport) | 4 days | Reuses Pi's gist pattern; content-hash addressing |
| `trail load` command | 2 days | |
| `trail export --format primer` | 3 days | Explicit handoff surface separate from `trail load` |
| **Website (Next.js, static):** landing + spec rendering + schema serving + viewer | 2 weeks | Four routes, one deployment. Landing copy from spec §1 verbatim |
| Parser Source Matrix completed for all 6 launch adapters | 1 week | Document version + observed schema for each |
| Real-data verification CI job (opt-in, on schedule) | 2 days | Catches silent schema drift early |
| Mapping cheatsheet docs (per adapter) | 2 days | |
| Public announcement: HN, X, Discord, agent communities | 1 day | |

**Phase 1 exit criteria:**

- 6 adapters with test coverage (fixtures + real-data tests).
- `trail share` produces a viewable URL at `agent-trail.dev/view/gist/<gist-id>`.
- Landing page at `agent-trail.dev/` orients visitors.
- Spec accessible at `agent-trail.dev/spec/v0.1.0`.
- JSON Schema accessible at `agent-trail.dev/schema/v0.1.0.json`.
- Viewer renders all event types.
- Parser Source Matrix complete and reproducible.
- Public launch post live.

**Launch positioning:**

- "We made coding agent sessions portable."
- Demos:
  1. Share a Claude Code session, open in browser viewer.
  2. Compare Aider session and Cursor session of same task side-by-side.
  3. Export a teammate's session as a context primer for another agent.

### 10.3 Phase 2 — Adoption & ecosystem (months 3-6)

**Goal:** Make the open format easier to adopt when other tools are ready. Community contributes adapters. Add high-value workflow integrations.

| Deliverable | Effort | Notes |
|---|---|---|
| Spec v0.2 — based on implementation feedback | ongoing | Likely compression, signing, multi-file |
| Community adapter PRs reviewed and merged | ongoing | Target: 5 more adapters via community |
| **PR/MR review integration** | 2 weeks | GitHub Action that posts session digest comments on PRs referencing trail URLs. Inspired by hwisu/opensession's PR automation. |
| **Cleanup automation** | 1 week | TTL-based cleanup of shared sessions (gist deletion after N days, configurable). |
| TypeScript SDK improvements | 1 week | Based on implementation and community feedback |
| Self-hosted index (lightweight, optional) | 2 weeks | For team scenarios |
| Tree view in web viewer | 1 week | If demand exists |

**Phase 2 exit criteria:**

- At least 2 third-party tools adopt Agent Trail as a supported format.
- At least 5 community-contributed adapters.
- 500+ GitHub stars on the Agent Trail monorepo.
- 1,000+ unique users of CLI (npm stats).
- At least one team-scale adopter uses the PR review integration.

### 10.4 Phase 3 — Maturity & governance (months 6-12)

**Goal:** Harden Agent Trail as an open-source standard and make it easier for independent tools and products to build on top.

| Deliverable | Effort | Notes |
|---|---|---|
| Tauri desktop app | 3 weeks | Local indexing, search; still open source |
| **Local vector search via Ollama** | 2 weeks | Optional; embeddings for semantic session search. Pattern from hwisu/opensession. |
| Governance process | ongoing | RFCs, compatibility policy, release cadence |
| Language SDKs | ongoing | Community-maintained ports for Python, Rust, Go, etc. |
| Reference integrations | ongoing | Examples showing how separate products can use Agent Trail |

**Phase 3 exit criteria:**

- Stable v1.0 criteria are met or clearly deferred.
- At least 3 external tools read or write trail files.
- Compatibility tests and governance process are active.

---

## 11. Success metrics

Leading and lagging indicators per phase.

### Phase 0 metrics

- ✅ Spec doc published
- ✅ Schema package published
- ✅ Generated types committed
- ✅ `trail validate` installable
- ✅ Strict validation fixtures passing

### Phase 1 metrics

- **Leading:** GitHub stars (target: 100 in first 2 weeks), npm installs/week.
- **Lagging:** Number of unique users of `trail share`, sessions shared via the format.

### Phase 2 metrics

- **Leading:** Community PRs, third-party tool integrations announced.
- **Lagging:** Active monthly users, sessions/week shared, adapters merged, teams using PR integration.

### Phase 3 metrics

- **Leading:** RFC participation, SDK ports, external integration PRs.
- **Lagging:** v1.0 readiness, compatibility test adoption, third-party tools reading/writing trail files.

### North-star metric

**Number of third-party tools that natively read or write trail files.** A single tool adoption can represent thousands of end users.

### Secondary launch proxies

- GitHub stars and community PRs.
- npm installs for `@agent-trail/cli` and `@agent-trail/adapters`.
- Aggregate viewer page hits on `agent-trail.dev`, without tracking individual users.
- Sessions shared via official tooling when measurable without invasive telemetry.

---

## 12. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Anthropic ships native Claude Code session sharing first, eats our use case | High | High | Position as cross-agent, not Claude-specific. Even if Anthropic ships sharing, they won't make Cursor sessions interop. |
| hwisu/opensession reaches adoption first; their HAIL format becomes de facto | Medium | High | Differentiate on TS-native, MCP-compatible, spec-first, smaller surface. They optimize for vertical product; we optimize for horizontal format. |
| One agent vendor formally pushes a competing spec | Medium | High | Keep Agent Trail small, open, and easy to interoperate with if convergence becomes useful later. |
| Format adoption is too slow; tool stays solo-user only | Medium | Medium | OSS-first means even solo users get value. External tool adoption validates the format. |
| Aider's lossy adapter feels broken; Aider users complain | Medium | Medium | Be explicit about lossy-by-design. Add Aider-specific renderer mode in v1.1. |
| Secret leakage in a shared session, public incident | Low | Catastrophic | Default-on redaction. Mandatory confirmation UI. Document threat model honestly. |
| TypeScript-first tooling excludes potential adopters (Go/Python/Rust shops) | Medium | High | Publish JSON Schema and spec in language-agnostic form; add language SDKs after the TS contract stabilizes. |
| Spec becomes too complex through later iterations | Medium | High | Strict editorial gate on what enters the spec. Most ideas go in `source.raw` or stay outside spec. |
| Source-agent schema drift breaks adapters silently | High | Medium | Real-data CI tests with version locks. Parser Source Matrix documents tested versions. |
| Name collision with Agent Trace causes confusion | Low | Low | Names diverge enough in practice; rename is cheap pre-launch if needed. |
| Site scope creeps from spec-page to product-site | Medium | Low | §16 names the surfaces we are deliberately NOT building. Reference before adding any new page. |

---

## 13. Open questions

Questions to resolve before or during specific phases:

### Before Phase 1

- Domain availability: confirm `agent-trail.dev` is claimable before publishing external schema IDs or public v0.1.0 packages; fall back to `agenttrail.dev` if not.
- npm scope: `@agent-trail` is registered.
- GitHub org: `agent-trail` is registered.
- Tagline for launch.

### Before Phase 2

- Self-hosted index architecture decision.
- Trademark on "Agent Trail."

### Before Phase 3

- Open governance model and RFC process.
- Maintainer/release responsibilities.
- Compatibility test ownership.

---

## 14. Out of scope (explicit)

Restating §4 with more detail:

- **Replacing source agents.** Agent Trail is a sidecar, not a replacement.
- **Real-time sync.** Snapshot sharing only.
- **A coding agent of our own.** No competition with Claude Code, Cursor, Pi.
- **Vertical session management product.** No competition with hwisu/opensession on its own terms; we are below them in the stack.
- **Auto-capture daemon.** Manual share by default; daemon-based always-on capture deferred indefinitely.
- **Proprietary URI scheme.** Sessions are files; locations are conventional. No `trail://` scheme.
- **Mobile native apps.** Web viewer is responsive; native deferred indefinitely.
- **Interview integrity / hiring tools.** Adjacent market; not v1.
- **Training-data dataset hosting.** Hugging Face does this; Agent Trail feeds into it but doesn't host.
- **Service-product concerns such as SSO, RBAC, and multi-tenancy.** These belong to separate products that may use Agent Trail.
- **On-chain anything.** Don't go there.

---

## 15. Dependencies & assumptions

### Dependencies

- **`gh` CLI** available on user's machine for `trail share` (gist transport).
- **`@redactpii/node`** continues to be maintained.
- **GitHub Gist** remains free for unlisted gists.
- **Vercel / Cloudflare Pages** free tier for static site hosting.
- **MCP protocol** remains stable enough to ship a deferred server after the v1 CLI/viewer launch.

### Assumptions

- Coding agent landscape continues to expand, not consolidate.
- Adopters care about openness. (If they don't, closed competitors win.)
- Solo dev pace of ~10 hours/week sustains through a longer Phase 1 timeline.
- hwisu/opensession remains a vertical product; doesn't pivot to spec-first.
- No major agent vendor unilaterally publishes a competing standard before our Phase 1.

---

## 16. Website non-goals (explicit)

The website at `agent-trail.dev` is deliberately *not* any of the following. When in doubt about whether a feature belongs on the site, return to this list.

- **A product marketing site.** No hero section, no value-proposition bullets, no "Built for engineers who care about X."
- **A docs site.** No `/docs` hierarchy, no getting-started tutorials, no how-to guides. Docs live in GitHub repo READMEs and the spec itself.
- **A blog.** No `/blog`, no announcements feed, no changelog timeline. Changelogs live in the spec markdown and repo releases.
- **A learn center.** No interactive tutorials, no curriculum. The spec is short enough to read.
- **A registry.** Adapters and tools are listed on the landing page. No separate `/registry` or `/marketplace`.
- **A community page.** No `/community`, `/contributors`, `/sponsors`. GitHub organizes contributors naturally.
- **A testimonials page.** No quotes, no logos of users.
- **A commercial page.** Agent Trail is open source; commercial packaging belongs outside this project.
- **A "compare to alternatives" page.** Comparison material belongs in the spec's acknowledgements appendix.
- **Analytics that track individual users.** Aggregate, privacy-respecting analytics only (Plausible or similar).
- **Newsletter signup.** No mailing list.
- **Authentication.** All routes are public; viewer works without login.

The closest precedents are `toml.io` (landing + versioned spec, no marketing) and `agent-trace.dev` (pure spec page, no landing). If something doesn't fit either of those, don't ship it.

---

## Appendix A — Competitive landscape

### Direct competitor: hwisu/opensession

**What it is:** A Rust-based vertical product for AI session sharing.

**Architecture:**
- Rust CLI (`opensession`) published on crates.io
- Daemon (`opensession-daemon`) for auto-capture
- Tauri desktop app (Svelte UI)
- Cloudflare Worker + server
- Local SQLite + Ollama for indexing/embeddings

**Format:** HAIL JSONL — not publicly spec'd as standalone document; lives inside code.

**Agents supported:** Codex CLI, Claude Code, Cursor, Gemini CLI, OpenCode (5 agents).

**Maturity:** 334 commits, 17 releases as of 2026-05. Sophisticated technically.

**Adoption:** 0 stars on GitHub as of writing. Despite shipping a lot, no visible community traction.

**Strengths over Agent Trail:**
- Already shipped working code
- Content-addressed identity (we adopted)
- PR/MR review integration
- Daemon-based auto-capture
- Local vector search via Ollama
- Cleanup automation with TTLs
- Git-native sharing via hidden refs (genuinely innovative)

**Weaknesses vs Agent Trail:**
- Vertical product, not spec; closed adoption story
- Rust-only; barrier for TS/Python ecosystem
- No MCP server
- 20+ commands; complex CLI surface
- No Pi adapter
- No casual sharing transport (git-native only)
- No spec doc separable from code

**Strategic response:** Position below them in the stack. Adopt their best ideas (content addressing, PR integration, semantic linking, doctor command) with credit. Keep Agent Trail useful as an independent open format.

### Adjacent spec: Agent Trace

**What it is:** A Cursor-led, multi-vendor specification for tracking AI-generated code attribution. Co-signers: Amp, Cline, Cloudflare, Cognition, git-ai, Jules (Google), OpenCode, Tapes, Vercel, Amplitude.

**Format:** JSON record format, line-range attribution anchored to git revisions.

**Relationship to Agent Trail:** Complementary, not competing. Agent Trace tracks attribution; Agent Trail tracks session content. Agent Trace's `conversation.url` can point to a trail file. We don't need to compete with or merge with them; they live at different layers.

**Strategic response:** Stay focused on session content. If Agent Trace ever expands to cover sessions, revisit then. Until then, the optional `vcs` field in our header lets us cross-reference cleanly.

### Other tools touching this space

**Cross-agent indexing / search:**
- **cass** (Dicklesworthstone) — Rust TUI/CLI, parses 19 agents, SQL index, no shareable artifact format. Reference for storage path discovery.
- **agenttrace** (luoyuctl) — observability, parses ~10 agents, has parser-guide doc.
- **pi-session-manager** (Dwsy) — Tauri app, multi-agent scan, tree visualization.

**Single-agent sharing:**
- **Claudebin** — closed-source, hosted, team features.
- **claudereview / ccshare** — MIT, multi-agent (Claude/Codex/Gemini), MCP server, self-hostable. **Closest direct competitor in TS ecosystem.**
- **claude-code-share** (wsxiaoys) — uses Pochi renderers.
- **sharemyclaude** — live terminal mirroring.
- **OpenCode** — native session sharing built in.

**Pi-specific:**
- **Pi `/share`** — gist + web viewer, no redaction.
- **pi-share-hf** — HF dataset upload, three-layer redaction (deterministic + TruffleHog + LLM). Reference for redaction architecture.

**Format / standard attempts:**
- **AFS / Agentation schema** — reference for spec design (tiered fields, event envelope, versioned URLs).
- **MCP** — not a session format, but normalized tool calls.

### Strategic positioning summary

Agent Trail is the only one of these that:
1. Is a spec, not a tool.
2. Targets all 19 agents (vs 5-10 for the others).
3. Is TS-native with planned MCP integration.
4. Lets other tools adopt the format without replacing their own products.

The closest competitor is hwisu/opensession (vertical product, overlapping scope). The closest adjacent TS ecosystem project is claudereview/ccshare (MIT, MCP, TS).

---

## Appendix B — Glossary

- **Agent Trail** — the format and project defined by `spec.md`.
- **Trail file** — a file conforming to the Agent Trail spec.
- **Adapter** — Component that reads a source agent's storage and emits a trail file.
- **Canonical event** — One of the 5 mandatory event types in the spec.
- **Content hash** — SHA-256 of canonical bytes; used for session identity and dedup.
- **Synthesized event** — An event produced by an adapter from non-event source data (e.g., git diffs in Aider).
- **Source escape hatch** — The `source.raw` field on events for lossless backup.
- **Semantic linking** — The `semantic.call_id` / `semantic.group_id` fields for cross-event references when explicit IDs are unreliable.
- **Tree session** — A session where events use `parent_id` to form a DAG (Pi, Claude Code subagents).
- **Linear session** — A session where no events use `parent_id` (most agents).
- **Active leaf** — The last event in a tree session; the "current position."
- **Parser Source Matrix** — Living doc tracking adapter source references and verification status per agent.

---

## Appendix C — Open spec governance (sketch)

Once the spec has external adopters, governance becomes relevant.

- **v0.x decisions:** author-driven, RFC-style issues for community input.
- **v1.0 milestone:** at least 3 external adopters before bumping major version.
- **Future:** RFC process modeled after Rust RFCs or TC39. Lightweight.
- **Trademark:** owned by the author for v0.x. Transferable to a foundation if it grows.

---

*End of Agent Trail PRD.*
