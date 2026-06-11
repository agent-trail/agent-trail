import { parseJsonlString, stampTrail } from "@agent-trail/core";
import type { Entry, Header } from "@agent-trail/types";
import pkg from "../../package.json" with { type: "json" };
import { buildTrailEnvelope } from "../envelope.ts";
import { applyHeaderMetadataUpdates } from "../header-metadata.ts";
import type {
  AdapterSourceHealth,
  DetectOptions,
  SessionRef,
  TrailAdapter,
  TrailFile,
} from "../index.ts";
import { applyParseFidelity } from "../parse-fidelity.ts";
import { resumeCommand } from "../resume.ts";
import { OPENCODE_ENTRY_ID_NAMESPACE } from "../session-uid.ts";
import { sanitizeTrailFile } from "../trail-sanitizer.ts";
import { readGitVcs } from "../vcs.ts";
import { synthesizeVcsCommitEvents } from "../vcs-commit.ts";
import { headerFromLoaded } from "./header.ts";
import { inspectSourceHealth } from "./health.ts";
import { entriesFromLoaded } from "./mappings.ts";
import { worktreeFromProject } from "./metadata.ts";
import { stringValue } from "./source.ts";
import { discoveredSummaries, loadDbSession, loadFileSession } from "./storage/index.ts";

const PRODUCER = `@agent-trail/adapters-opencode/${pkg.version}`;

async function stampTrailFile(trail: TrailFile): Promise<TrailFile> {
  const sanitizedTrail = sanitizeTrailFile(trail);
  const records = [
    ...(sanitizedTrail.envelope !== undefined ? [sanitizedTrail.envelope] : []),
    ...sanitizedTrail.groups.flatMap((group) => [group.header, ...group.entries]),
  ];
  const parsed = await parseJsonlString(
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  stampTrail(parsed);
  const values = parsed.map((record) => record.value);
  const envelope = values[0] as TrailFile["envelope"];
  const header = values[1] as Header;
  const entries = values.slice(2) as Entry[];
  return sanitizeTrailFile({ envelope, groups: [{ header, entries }] });
}

export const opencodeAdapter: TrailAdapter = {
  name: "opencode",

  async detectSessions(_opts?: DetectOptions): Promise<SessionRef[]> {
    return (await discoveredSummaries(_opts)).map((session) => ({
      id: session.id,
      adapter: "opencode",
      cwd: session.cwd,
      modifiedAt: session.modifiedAt,
      path: session.path,
    }));
  },

  async parseSession(ref: SessionRef): Promise<TrailFile> {
    if (ref.path === undefined) throw new Error("OpenCode parseSession requires ref.path");
    const loaded = ref.path.includes("#")
      ? loadDbSession(ref.path)
      : await loadFileSession(ref.path);
    const header = headerFromLoaded(loaded, ref);
    const vcs = header.cwd === undefined ? undefined : await readGitVcs(header.cwd);
    if (vcs !== undefined) {
      const projectWorktree = worktreeFromProject(loaded.project);
      header.vcs = {
        ...vcs,
        ...(vcs.worktree === undefined && projectWorktree !== undefined
          ? { worktree: projectWorktree }
          : {}),
      };
    }
    const entries = synthesizeVcsCommitEvents(entriesFromLoaded(loaded, header), {
      idNamespace: OPENCODE_ENTRY_ID_NAMESPACE,
      repo: header.vcs?.remote_url,
    });
    applyHeaderMetadataUpdates(header, entries);
    applyParseFidelity(header, entries);
    const group = { header, entries };
    return stampTrailFile({
      envelope: buildTrailEnvelope({
        producer: PRODUCER,
        groups: [group],
        name: stringValue(loaded.session.title) ?? stringValue(loaded.session.slug),
      }),
      groups: [group],
    });
  },

  async resumeSession(ref: SessionRef) {
    return resumeCommand(ref, `Resume OpenCode session ${ref.id}`, [
      "opencode",
      "--session",
      ref.id,
    ]);
  },

  async isAvailable(): Promise<boolean> {
    const health = await inspectSourceHealth();
    return health.present && health.readable;
  },

  async sourceVersion(): Promise<string | null> {
    return (await inspectSourceHealth()).sourceVersion;
  },

  async sourceHealth(): Promise<AdapterSourceHealth> {
    return inspectSourceHealth();
  },
};
