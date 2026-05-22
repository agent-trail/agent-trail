import { expect, test } from "bun:test";
import { appendFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeContentHash } from "./hash.ts";
import { parseJsonlString } from "./jsonl.ts";
import { validateTrailString } from "./validation.ts";

type EventValue = Record<string, unknown>;

async function makeLiveSession(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "trail-smoke-"));
  const path = join(dir, "session.trail.jsonl");
  const header = {
    type: "session",
    schema_version: "0.1.0",
    id: "sess-smoke",
    ts: "2026-05-22T09:00:00.000Z",
    stream: { state: "open", started_at: "2026-05-22T09:00:00.000Z" },
    agent: { name: "codex-cli" },
  };
  await Bun.write(path, `${JSON.stringify(header)}\n`);
  return path;
}

async function appendEvent(path: string, event: EventValue): Promise<void> {
  await appendFile(path, `${JSON.stringify(event)}\n`);
}

async function finalizeHeader(path: string): Promise<void> {
  const text = await Bun.file(path).text();
  const records = await parseJsonlString(text);
  const header = records[0];
  if (header === undefined) throw new Error("missing header");
  const stream = header.value.stream as Record<string, unknown> | undefined;
  header.value.stream = { ...(stream ?? {}), state: "closed" };
  const digest = computeContentHash(records);
  header.value.content_hash = digest;
  const lines = records.map((r) => JSON.stringify(r.value));
  await Bun.write(path, `${lines.join("\n")}\n`);
}

test("smoke: live daemon emits a clean finalized session", async () => {
  const path = await makeLiveSession();

  // Live phase: validator should see only the live-stream marker, no errors.
  await appendEvent(path, {
    type: "user_message",
    id: "evta1",
    ts: "2026-05-22T09:00:01.000Z",
    payload: { text: "summarize README" },
  });
  await appendEvent(path, {
    type: "tool_call",
    id: "evta2",
    ts: "2026-05-22T09:00:02.000Z",
    payload: { tool: "file_read", args: { path: "README.md" } },
  });

  const midFlightDiagnostics = await validateTrailString(await Bun.file(path).text());
  expect(midFlightDiagnostics.some((d) => d.code === "unmatched_tool_call_at_eof")).toBe(true);

  await appendEvent(path, {
    type: "tool_result",
    id: "evta3",
    ts: "2026-05-22T09:00:03.000Z",
    payload: { for_id: "evta2", ok: true, output: "# trail" },
  });
  await appendEvent(path, {
    type: "agent_message",
    id: "evta4",
    ts: "2026-05-22T09:00:04.000Z",
    payload: { text: "the readme starts with `# trail`" },
  });
  await appendEvent(path, {
    type: "session_end",
    id: "evta5",
    ts: "2026-05-22T09:00:05.000Z",
    payload: { reason: "complete", final_message_id: "evta4" },
  });

  await finalizeHeader(path);

  const finalDiagnostics = await validateTrailString(await Bun.file(path).text());
  expect(finalDiagnostics).toEqual([]);
});

test("smoke: daemon killed mid tool_call surfaces unmatched_tool_call_at_eof", async () => {
  const path = await makeLiveSession();
  await appendEvent(path, {
    type: "user_message",
    id: "evta1",
    ts: "2026-05-22T09:00:01.000Z",
    payload: { text: "run a build" },
  });
  await appendEvent(path, {
    type: "tool_call",
    id: "evta2",
    ts: "2026-05-22T09:00:02.000Z",
    payload: { tool: "shell_command", args: { command: "bun run build" } },
  });
  // Daemon dies; no tool_result, no terminal, header still "open".

  const diagnostics = await validateTrailString(await Bun.file(path).text());
  const codes = diagnostics.map((d) => d.code);
  expect(codes).toContain("unmatched_tool_call_at_eof");
});

test("smoke: crash supervisor writes session_terminated with open_call_ids", async () => {
  const path = await makeLiveSession();
  await appendEvent(path, {
    type: "tool_call",
    id: "evta1",
    ts: "2026-05-22T09:00:01.000Z",
    payload: { tool: "shell_command", args: { command: "sleep 9999" } },
  });
  // Supervisor detects death, appends an explicit terminator before
  // finalizing the header.
  await appendEvent(path, {
    type: "session_terminated",
    id: "evta2",
    ts: "2026-05-22T09:00:02.000Z",
    payload: { reason: "process_terminated", open_call_ids: ["evta1"] },
  });
  await finalizeHeader(path);

  const diagnostics = await validateTrailString(await Bun.file(path).text());
  expect(diagnostics).toEqual([]);
});

test("smoke: streaming agent uses semantic.call_id pairing without for_id", async () => {
  const path = await makeLiveSession();
  await appendEvent(path, {
    type: "tool_call",
    id: "evta1",
    ts: "2026-05-22T09:00:01.000Z",
    semantic: { call_id: "toolu_xyz" },
    payload: { tool: "file_read", args: { path: "README.md" } },
  });
  await appendEvent(path, {
    type: "tool_result",
    id: "evta2",
    ts: "2026-05-22T09:00:02.000Z",
    semantic: { call_id: "toolu_xyz" },
    payload: { ok: true, output: "..." },
  });
  await appendEvent(path, {
    type: "session_end",
    id: "evta3",
    ts: "2026-05-22T09:00:03.000Z",
    payload: { reason: "agent_idle" },
  });
  await finalizeHeader(path);

  const diagnostics = await validateTrailString(await Bun.file(path).text());
  expect(diagnostics).toEqual([]);
});
