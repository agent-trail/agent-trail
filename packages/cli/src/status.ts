import {
  IndexCorruptError,
  IndexVersionError,
  readIndex,
  resolveStoreRoot,
} from "@agent-trail/store";
import type { Command } from "commander";
import { cliDefaultAdapters, type TrailAdapter } from "./adapters.ts";
import { addExamples, type ResultWriter } from "./command.ts";
import type { ResolvedConfig } from "./config.ts";

export type AdapterStatus = {
  adapter: string;
  status: "ok" | "warn";
  path: string | null;
  present: boolean;
  readable: boolean;
  session_count: number;
  source_version: string | null;
  warnings: string[];
};

export type StoreStatus = {
  root: string;
  entries: number;
  sessions: number;
  trails: number;
};

export type TrailStatus = {
  cwd: string;
  store: StoreStatus;
  config: ResolvedConfig;
  adapters: AdapterStatus[];
  warnings: string[];
};

export type RunStatusOptions = {
  json?: boolean;
};

export type RunStatusContext = {
  adapters?: readonly TrailAdapter[];
  config?: ResolvedConfig;
  projectRoot?: string;
  storeRoot?: string;
};

export type RunStatusResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function collectAdapterStatuses(
  adapters: readonly TrailAdapter[],
): Promise<AdapterStatus[]> {
  return Promise.all(
    adapters.map(async (adapter): Promise<AdapterStatus> => {
      try {
        const health = await adapter.sourceHealth();
        return {
          adapter: health.adapter,
          status: health.present && health.readable && health.warnings.length === 0 ? "ok" : "warn",
          path: health.path,
          present: health.present,
          readable: health.readable,
          session_count: health.sessionCount,
          source_version: health.sourceVersion,
          warnings: health.warnings,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          adapter: adapter.name,
          status: "warn",
          path: null,
          present: false,
          readable: false,
          session_count: 0,
          source_version: null,
          warnings: [`health check failed: ${message}`],
        };
      }
    }),
  );
}

export async function collectTrailStatus(context: RunStatusContext): Promise<TrailStatus> {
  if (context.config === undefined) {
    throw new Error("resolved config unavailable");
  }
  const { warnings, ...store } = await collectStoreStatus(context.storeRoot);
  const adapters = await collectAdapterStatuses(context.adapters ?? cliDefaultAdapters());
  return {
    cwd: context.projectRoot ?? process.cwd(),
    store,
    config: context.config,
    adapters,
    warnings,
  };
}

export async function runStatus(
  options: RunStatusOptions = {},
  context: RunStatusContext,
): Promise<RunStatusResult> {
  let status: TrailStatus;
  try {
    status = await collectTrailStatus(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `status: ${message}\n` };
  }
  return {
    exitCode: 0,
    stdout: options.json === true ? `${JSON.stringify(status)}\n` : renderStatusText(status),
    stderr: "",
  };
}

export function escapeStatusTextSegment(value: string): string {
  let escaped = "";
  for (const character of value) {
    const charCode = character.charCodeAt(0);
    if (charCode < 0x20 || (charCode >= 0x7f && charCode <= 0x9f)) {
      switch (character) {
        case "\n":
          escaped += "\\n";
          break;
        case "\r":
          escaped += "\\r";
          break;
        case "\t":
          escaped += "\\t";
          break;
        default:
          escaped += `\\u${charCode.toString(16).padStart(4, "0")}`;
      }
    } else {
      escaped += character;
    }
  }
  return escaped;
}

function renderStatusText(status: TrailStatus): string {
  const lines = [
    `cwd: ${escapeStatusTextSegment(status.cwd)}`,
    `store: ${escapeStatusTextSegment(status.store.root)} (${status.store.entries} entries, ${status.store.sessions} sessions, ${status.store.trails} trails)`,
    `config: ${status.config.sources
      .map(
        (source) =>
          `${escapeStatusTextSegment(source.layer)}:${escapeStatusTextSegment(source.status)}`,
      )
      .join(", ")}`,
    "adapters:",
    ...status.adapters.map(
      (adapter) =>
        `  ${adapter.status}  ${escapeStatusTextSegment(adapter.adapter)}: ${adapter.session_count} sessions${
          adapter.path === null ? "" : ` at ${escapeStatusTextSegment(adapter.path)}`
        }`,
    ),
    ...status.adapters.flatMap((adapter) =>
      adapter.warnings.map(
        (warning) =>
          `warning: ${escapeStatusTextSegment(adapter.adapter)}: ${escapeStatusTextSegment(warning)}`,
      ),
    ),
    ...status.warnings.map((warning) => `warning: ${escapeStatusTextSegment(warning)}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function collectStoreStatus(
  storeRootOverride: string | undefined,
): Promise<StoreStatus & { warnings: string[] }> {
  const root = resolveStoreRoot(storeRootOverride);
  try {
    const index = await readIndex(root);
    const entries = Object.values(index.entries);
    const sessions = entries.filter((entry) => {
      const kind = entry.kind ?? "session";
      return kind === "session";
    }).length;
    const trails = entries.filter((entry) => entry.kind === "trail").length;
    return { root, entries: entries.length, sessions, trails, warnings: [] };
  } catch (error) {
    if (error instanceof IndexCorruptError || error instanceof IndexVersionError) {
      return { root, entries: 0, sessions: 0, trails: 0, warnings: [error.message] };
    }
    throw error;
  }
}

export function addStatusCommand(
  program: Command,
  writeResult: ResultWriter,
  context: RunStatusContext,
): void {
  addExamples(
    program
      .command("status")
      .option("--json", "Print status as JSON.", false)
      .description("Show Trail CLI, store, config, and adapter status.")
      .action(async (options: RunStatusOptions) => {
        writeResult(await runStatus(options, context));
      }),
    ["trail status", "trail status --json"],
  );
}
