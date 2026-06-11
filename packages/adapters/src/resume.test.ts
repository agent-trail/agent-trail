import { expect, test } from "bun:test";
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "./index.ts";
import { claudeCodeAdapter, codexAdapter, opencodeAdapter, piAdapter } from "./index.ts";

const ref: SessionRef = {
  id: "sess-resume",
  adapter: "codex",
  cwd: "/work/project",
  path: "/tmp/session.jsonl",
};

const noOpAdapter: TrailAdapter = {
  name: "no-op",
  async detectSessions(_opts?: DetectOptions): Promise<SessionRef[]> {
    return [];
  },
  async parseSession(): Promise<TrailFile> {
    return { groups: [] };
  },
  async isAvailable(): Promise<boolean> {
    return false;
  },
  async sourceVersion(): Promise<string | null> {
    return null;
  },
  async sourceHealth() {
    return {
      adapter: "no-op",
      path: null,
      present: false,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: [],
    };
  },
};

test("resumeSession is optional on TrailAdapter", () => {
  expect(noOpAdapter.resumeSession).toBeUndefined();
});

test("codex resumes by session id", async () => {
  await expect(codexAdapter.resumeSession?.(ref)).resolves.toEqual({
    supported: true,
    command: {
      label: "Resume Codex session sess-resume",
      argv: ["codex", "resume", "sess-resume"],
      cwd: "/work/project",
    },
  });
});

test("claude-code resumes by session id", async () => {
  await expect(
    claudeCodeAdapter.resumeSession?.({ ...ref, adapter: "claude-code" }),
  ).resolves.toEqual({
    supported: true,
    command: {
      label: "Resume Claude Code session sess-resume",
      argv: ["claude", "--resume", "sess-resume"],
      cwd: "/work/project",
    },
  });
});

test("opencode resumes by session id", async () => {
  await expect(opencodeAdapter.resumeSession?.({ ...ref, adapter: "opencode" })).resolves.toEqual({
    supported: true,
    command: {
      label: "Resume OpenCode session sess-resume",
      argv: ["opencode", "--session", "sess-resume"],
      cwd: "/work/project",
    },
  });
});

test("pi resumes by session id", async () => {
  await expect(piAdapter.resumeSession?.({ ...ref, adapter: "pi" })).resolves.toEqual({
    supported: true,
    command: {
      label: "Resume Pi session sess-resume",
      argv: ["pi", "--session", "sess-resume"],
      cwd: "/work/project",
    },
  });
});

test("pi resumes timestamp-prefixed session filenames by trailing uuid", async () => {
  await expect(
    piAdapter.resumeSession?.({
      ...ref,
      adapter: "pi",
      id: "2026-06-10T18-49-02-034Z_019eb2dd-d152-748b-8a75-fdb97c71c7fc",
    }),
  ).resolves.toEqual({
    supported: true,
    command: {
      label: "Resume Pi session 019eb2dd-d152-748b-8a75-fdb97c71c7fc",
      argv: ["pi", "--session", "019eb2dd-d152-748b-8a75-fdb97c71c7fc"],
      cwd: "/work/project",
    },
  });
});
