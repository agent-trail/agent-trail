# CLI and adapters are Bun-only

`@agent-trail/cli` and downstream packages that compile into the CLI binary (planned `@agent-trail/adapters`) run on Bun only. They use Bun-native APIs freely (`Bun.file`, `Bun.write`, `bun:sqlite`, `Bun.spawn`) and ship as standalone executables via `bun build --compile` to GitHub Releases, Homebrew, and an install script. Library packages consumed by third parties (`@agent-trail/core`, `@agent-trail/schema`, `@agent-trail/types`, `@agent-trail/redact`) remain Node 20+ and Bun compatible per ADR-0002.

This supersedes ADR-0002's "Published JavaScript packages support Node 20+ and Bun" specifically for `@agent-trail/cli` and adapter packages that link into it. Libraries others import in their own projects keep the original constraint.

**Considered Options**

- Bun-only CLI and adapters, dual-runtime libraries (chosen).
- Dual-runtime everywhere with `better-sqlite3` for Cursor adapter SQLite extraction and `npm install -g` distribution.
- Dual-runtime source plus per-platform compiled binaries wrapped in an npm package.

**Consequences**

- End users install zero JavaScript runtime; `trail` is a self-contained binary.
- Cursor adapter uses built-in `bun:sqlite` instead of a native module that breaks `npm install -g` on user machines.
- `npm install -g @agent-trail/cli` is no longer a supported install path; the PRD §8.3 distribution model becomes binary-only.
- CLI authors and adapter contributors need Bun ≥ 1.3.11 installed; library contributors can still use Node.
- Packaging pipeline (cross-compile via `bun build --compile`, GitHub Releases, Homebrew tap, install script) ships in a separate issue.
