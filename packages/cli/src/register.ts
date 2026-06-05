import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionRef, trailRecords } from "@agent-trail/adapters";
import { canonicalizeRecords, parseJsonlString, stampTrail } from "@agent-trail/core";
import { type RegisterResult, registerTrail } from "@agent-trail/store";
import type { Command } from "commander";
import { cliAdapterByName, cliAdapterNames, type TrailAdapter } from "./adapters.ts";
import { addExamples, type CliResult, type ResultWriter } from "./command.ts";

export type RunRegisterOptions = {
  input: string;
  json?: boolean;
};

export type RunRegisterContext = {
  storeRoot?: string;
  adapters?: readonly TrailAdapter[];
};

export type RegisterFromAdapterOptions = {
  adapter: TrailAdapter;
  storeRoot?: string;
};

type AdapterRef = {
  adapterName: string;
  id: string;
};

export async function runRegister(
  options: RunRegisterOptions,
  context: RunRegisterContext = {},
): Promise<CliResult> {
  if (await inputIsExistingFile(options.input)) {
    const fileReg = await registerFile(options.input, context);
    if ("exitCode" in fileReg) return fileReg;
    return renderRegisterResult(fileReg, options);
  }

  const parsedRef = parseAdapterRef(options.input);
  if (typeof parsedRef === "string") {
    return { exitCode: 1, stdout: "", stderr: `${parsedRef}\n` };
  }

  const reg =
    parsedRef === null
      ? await registerFile(options.input, context)
      : await registerAdapterRef(parsedRef, context);

  if ("exitCode" in reg) return reg;
  return renderRegisterResult(reg, options);
}

async function registerFile(
  input: string,
  context: RunRegisterContext,
): Promise<RegisterResult | CliResult> {
  try {
    return await registerTrail(input, { storeRoot: context.storeRoot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `register: ${message}\n` };
  }
}

export async function registerFromAdapter(
  ref: SessionRef,
  options: RegisterFromAdapterOptions,
): Promise<RegisterResult> {
  const trail = await options.adapter.parseSession(ref);
  const jsonl = `${trailRecords(trail)
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;
  const records = await parseJsonlString(jsonl);
  stampTrail(records);
  const canonical = canonicalizeRecords(records);
  const tmpDir = await mkdtemp(join(tmpdir(), "trail-register-adapter-"));
  const tmpFile = join(tmpDir, "session.trail.jsonl");
  try {
    await writeFile(tmpFile, canonical, "utf8");
    return await registerTrail(tmpFile, {
      storeRoot: options.storeRoot,
      sourcePath: ref.path ?? null,
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function parseAdapterRef(input: string): AdapterRef | string | null {
  const separator = input.indexOf(":");
  if (separator === -1) return null;

  const adapterName = input.slice(0, separator);
  const id = input.slice(separator + 1);
  if (adapterName.length > 0 && !/^[a-z][a-z0-9-]*$/.test(adapterName)) return null;
  if (adapterName.length === 0 || id.length === 0) {
    return "register: adapter session refs must use <adapter>:<id>";
  }
  if (id.includes("~")) {
    return "register: '~' is reserved in adapter session refs for future host-qualified ids";
  }
  return { adapterName, id };
}

async function registerAdapterRef(
  ref: AdapterRef,
  context: RunRegisterContext,
): Promise<RegisterResult | CliResult> {
  const adapter = cliAdapterByName(ref.adapterName, context.adapters);
  const validNames = cliAdapterNames(context.adapters);
  if (adapter === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `register: unknown adapter '${ref.adapterName}' (valid adapters: ${validNames.join(", ")})\n`,
    };
  }

  let sessions: SessionRef[];
  try {
    sessions = await adapter.detectSessions({ allCwds: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `register: ${adapter.name} detectSessions failed: ${message}\n`,
    };
  }

  const matches = sessions.filter((session) => session.id === ref.id);
  if (matches.length === 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `register: no ${adapter.name} session with id '${ref.id}'\n`,
    };
  }
  if (matches.length > 1) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `register: multiple ${adapter.name} sessions with id '${ref.id}'; run \`trail discover --all --json\` to inspect duplicates\n`,
    };
  }

  try {
    return await registerFromAdapter(matches[0]!, {
      adapter,
      storeRoot: context.storeRoot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `register: ${message}\n` };
  }
}

async function inputIsExistingFile(input: string): Promise<boolean> {
  try {
    return (await stat(input)).isFile();
  } catch {
    return false;
  }
}

function renderRegisterResult(result: RegisterResult, options: RunRegisterOptions): CliResult {
  if (result.status === "skipped_pending") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "register: trail missing finalized content_hash (spec §7.3)\n",
    };
  }
  if (result.status === "invalid" || result.contentHash === null || result.objectPath === null) {
    const lines = result.diagnostics.map((d) => d.message).join("\n");
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${lines.length > 0 ? `${lines}\n` : ""}register: trail did not register (status: ${result.status})\n`,
    };
  }

  if (options.json === true) {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({
        status: result.status,
        content_hash: result.contentHash,
        object_path: result.objectPath,
      })}\n`,
      stderr: "",
    };
  }
  return { exitCode: 0, stdout: `${result.contentHash}\n`, stderr: "" };
}

export function addRegisterCommand(program: Command, writeResult: ResultWriter): void {
  addExamples(
    program
      .command("register")
      .argument("<file|adapter:id>")
      .option("--json", "Print registration result as JSON.", false)
      .description("Register a Trail file or source-agent session.")
      .action(async (input: string, options: { json: boolean }) => {
        writeResult(await runRegister({ input, json: options.json }));
      }),
    ["trail register session.trail.jsonl", "trail register claude-code:abc123"],
  );
}
