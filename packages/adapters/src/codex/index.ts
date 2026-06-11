import pkg from "../../package.json" with { type: "json" };
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "../index.ts";
import { resumeCommand } from "../resume.ts";
import { parseCodexTrailFile } from "./assembly.ts";
import { detectCodexSessions, dirExists, newestCodexSourceVersion } from "./discovery.ts";
import { inspectSourceHealth } from "./health.ts";
import { codexSessionsDir } from "./paths.ts";

const PRODUCER = `@agent-trail/adapters-codex/${pkg.version}`;

export const codexAdapter: TrailAdapter = {
  name: "codex",

  detectSessions(opts?: DetectOptions): Promise<SessionRef[]> {
    return detectCodexSessions(opts);
  },

  async parseSession(ref: SessionRef): Promise<TrailFile> {
    if (ref.path === undefined) {
      throw new Error("Codex adapter requires SessionRef.path");
    }
    return parseCodexTrailFile(ref.path, PRODUCER);
  },

  async resumeSession(ref: SessionRef) {
    return resumeCommand(ref, `Resume Codex session ${ref.id}`, ["codex", "resume", ref.id]);
  },

  async isAvailable(): Promise<boolean> {
    const dir = codexSessionsDir();
    if (dir === undefined) return false;
    return dirExists(dir);
  },

  sourceVersion(): Promise<string | null> {
    return newestCodexSourceVersion();
  },

  sourceHealth: inspectSourceHealth,
};
