import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildTranscriptItemsForViewer,
  isScrollInterruptionKey,
  resolveProgrammaticSettledItem,
  setHashForSidebarTarget,
  shouldCenterSidebar,
  shouldCommitSidebarActiveState,
  ViewerShell,
} from "./components/viewer-shell.tsx";
import { TranscriptPane } from "./components/viewer-transcript.tsx";
import { buildGistViewerModel, type ViewerEvent } from "./gist-viewer.ts";
import { seedSharedTrailPayload, seedSharedTrailRecords } from "./test-support.ts";

test("viewer shell renders loaded shared trail state and warnings", async () => {
  const seed = await seedSharedTrailPayload({ overrideHash: "0".repeat(64) });
  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/hash-mismatch",
    }),
  });

  const markup = renderToStaticMarkup(createElement(ViewerShell, { model }));

  expect(markup).toContain("content_hash_mismatch");
  expect(markup).toContain("hello from shared trail");
  expect(markup).toContain("Events");
  expect(markup).toContain("1 total");
  expect(markup).toContain('aria-label="User messages"');
  expect(markup).toContain('aria-label="Agent response messages"');
  expect(markup).toContain('aria-label="Agent thinking messages"');
  expect(markup).toContain('aria-label="Tool calls"');
  expect(markup).toContain("Trail transcript");
  expect(markup).toContain("User_input");
  expect(markup).toContain("2026-05-17  14:00:05");
  expect(markup).toContain("viewer-user-message");
  expect(markup).toContain("viewer-user-details");
  expect(markup).toContain("viewer-user-summary");
  expect(markup).toContain("min-h-5 cursor-pointer");
  expect(markup).toContain("tabular-nums");
  expect(markup).toContain("overflow-y-auto border-r-main px-4 py-4");
  expect(markup).toContain("viewer-pressable grid h-5");
  expect(markup).toContain("viewer-mobile-filter-bar");
  expect(markup).toContain("lg:hidden");
  expect(markup).toContain("hidden min-h-0 min-w-0 flex-col border-b-main");
  expect(markup).toContain("grid h-full min-h-0 w-full max-w-full overflow-hidden");
  expect(markup).not.toContain("overflow-hidden border-t-main bg-bg");
  expect(markup).toContain(
    "h-full min-h-0 min-w-0 scroll-smooth overflow-y-auto bg-bg px-4 py-6 md:px-6 md:py-8",
  );
  expect(markup).toContain("grid min-w-0 gap-8 md:gap-10");
  expect(markup).toContain("viewer-user-message mt-4");
  expect(markup).toContain("px-3 py-2");
  expect(markup).not.toContain("viewer-user-message mt-5");
  expect(markup).not.toContain("p-3 text-sm");
  expect(markup).toContain('aria-current="true"');
});

test("viewer shell renders user, agent, and tool events only", async () => {
  const seed = await seedSharedTrailRecords([
    {
      type: "user_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "Render core events" },
    },
    {
      type: "agent_message",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-17T14:00:06.000Z",
      payload: { text: "Rendering now." },
    },
    {
      type: "agent_thinking",
      id: "01HEVTA0000000000000000007",
      ts: "2026-05-17T14:00:06.500Z",
      payload: { text: "Keep thinking visible." },
    },
    {
      type: "tool_call",
      id: "01HEVTA0000000000000000003",
      ts: "2026-05-17T14:00:07.000Z",
      payload: { tool: "shell_command", args: { command: "bun test", cwd: "/tmp/project" } },
    },
    {
      type: "tool_result",
      id: "01HEVTA0000000000000000004",
      ts: "2026-05-17T14:00:08.000Z",
      payload: {
        for_id: "01HEVTA0000000000000000003",
        ok: false,
        error:
          "Wall time: 3.1604 seconds\nProcess exited with code 1\nOutput:\nTotal output lines: 1570\n\nexit 1",
      },
    },
    {
      type: "session_summary",
      id: "01HEVTA0000000000000000005",
      ts: "2026-05-17T14:00:09.000Z",
      payload: { scope: "session", text: "Core events rendered." },
    },
    {
      type: "future_event",
      id: "01HEVTA0000000000000000006",
      ts: "2026-05-17T14:00:10.000Z",
      payload: { text: "future shape" },
    },
  ]);
  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/shell-events",
    }),
  });

  const markup = renderToStaticMarkup(createElement(ViewerShell, { model }));

  expect(markup).toContain("Render core events");
  expect(markup).toContain("Rendering now.");
  expect(markup).toContain("Keep thinking visible.");
  expect(markup).toContain("Agent_reply");
  expect(markup).toContain("Thought");
  expect(markup).toContain("Think");
  expect(markup).toContain("viewer-agent-message");
  expect(markup).toContain("viewer-agent-details");
  expect(markup).toContain("viewer-agent-summary");
  expect(markup).toContain("viewer-thinking-details");
  expect(markup).toContain("viewer-thinking-summary");
  expect(markup).toContain("2026-05-17  14:00:06");
  expect(markup).toContain("Tool call: shell_command");
  expect(markup).toContain("bun test");
  expect(markup).toContain("Tool result: error");
  expect(markup).toContain(">wall time:</dt>");
  expect(markup).toContain("3.1604 seconds");
  expect(markup).toContain(">exit code:</dt>");
  expect(markup).toContain(">total output lines:</dt>");
  expect(markup).toContain("1570");
  expect(markup).toContain("exit 1");
  expect(markup).toContain("viewer-terminal-block");
  expect(markup).toContain("viewer-terminal-header");
  expect(markup.match(/viewer-terminal-block/g)).toHaveLength(2);
  expect(markup).toContain("/tmp/project");
  expect(markup).not.toContain('class="font-bold uppercase">command:</dt>');
  expect(markup).not.toContain(">cwd:</dt>");
  expect(markup).not.toContain("Process exited with code 1");
  expect(markup).not.toContain("Total output lines: 1570");
  expect(markup).toContain("4 total");
  expect(markup).toContain("<details");
  expect(markup).toContain("group/tool-event");
  expect(markup).toContain("group/result");
  expect(markup).toContain("viewer-tool-event-summary");
  expect(markup).toContain("viewer-result-summary");
  expect(markup).toContain("viewer-pressable flex min-h-7");
  expect(markup).not.toContain("viewer-tool-summary");
  expect(markup).not.toContain("viewer-tool-details");
  expect(markup).toContain("[+]");
  expect(markup).toContain("[-]");
  expect(markup).toContain("group-open/tool-event:hidden");
  expect(markup).toContain("group-open/result:hidden");
  expect(markup).toContain("grid max-h-80 gap-2 overflow-auto border-t-main p-3");
  expect(markup).not.toContain("max-h-48");
  expect(markup).not.toContain(">for:</dt>");
  expect(markup).toContain("group-open/user:hidden");
  expect(markup).toContain("group-open/agent:hidden");
  expect(markup).toContain("group-open/thinking:hidden");
  expect(markup).toContain('<details class="viewer-tool-event-details');
  expect(markup).not.toContain('<details open="" class="viewer-tool-event-details');
  expect(markup).not.toContain("Session summary");
  expect(markup).not.toContain("Core events rendered.");
  expect(markup).not.toContain("Unknown record: future_event");
  expect(markup).not.toContain("future shape");
  expect(markup).toContain("reader_tolerant_unknown_record");
});

test("viewer shell groups consecutive tool calls into one collapsible tool group", async () => {
  const seed = await seedSharedTrailRecords([
    {
      type: "tool_call",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { tool: "file_search", args: { query: "useTrail" } },
    },
    {
      type: "tool_result",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-17T14:00:06.000Z",
      payload: { for_id: "01HEVTA0000000000000000001", ok: true, output: "src/useTrail.ts" },
    },
    {
      type: "tool_call",
      id: "01HEVTA0000000000000000003",
      ts: "2026-05-17T14:00:07.000Z",
      payload: { tool: "file_read", args: { path: "src/useTrail.ts" } },
    },
    {
      type: "tool_result",
      id: "01HEVTA0000000000000000004",
      ts: "2026-05-17T14:00:08.000Z",
      payload: { for_id: "01HEVTA0000000000000000003", ok: true, output: "export const useTrail" },
    },
    {
      type: "agent_message",
      id: "01HEVTA0000000000000000005",
      ts: "2026-05-17T14:00:09.000Z",
      payload: { text: "Found the hook." },
    },
  ]);
  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/grouped-tools",
    }),
  });

  const markup = renderToStaticMarkup(createElement(ViewerShell, { model }));

  expect(markup).toContain("Tool_group: 2 Events");
  expect(markup).toContain("2026-05-17  14:00:05");
  expect(markup).not.toContain("Tool Group: 2 Events");
  expect(markup).toContain("2 grouped tool calls");
  expect(markup).toContain("viewer-tool-group-details");
  expect(markup).toContain("viewer-tool-group-summary");
  expect(markup).toContain("viewer-tool-group-stack");
  expect(markup).toContain("viewer-tool-details-compact");
  expect(markup).not.toContain("viewer-tool-group-details group/tool-group mt-5 border-main");
  expect(markup).toContain("Tool call: file_search");
  expect(markup).toContain("Tool call: file_read");
  expect(markup).toContain("src/useTrail.ts");
  expect(markup).toContain("export const useTrail");
  expect(markup).toContain("2 total");
  expect(markup).not.toContain("viewer-terminal-block");
  expect(markup).not.toContain("<details open");
});

test("viewer shell renders file edit diffs with diff rows and fallback code blocks", async () => {
  const seed = await seedSharedTrailRecords([
    {
      type: "tool_call",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: {
        tool: "file_edit",
        args: {
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,2 @@\n-old line\n+new line",
          path: "src/app.ts",
        },
      },
    },
    {
      type: "agent_message",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-17T14:00:06.000Z",
      payload: { text: "Separated." },
    },
    {
      type: "tool_call",
      id: "01HEVTA0000000000000000003",
      ts: "2026-05-17T14:00:07.000Z",
      payload: {
        tool: "file_edit",
        args: {
          diff: "changed src/app.ts without unified diff markers",
          path: "src/app.ts",
        },
      },
    },
  ]);
  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/file-edit-diff",
    }),
  });

  const markup = renderToStaticMarkup(createElement(ViewerShell, { model }));

  expect(markup).toContain("viewer-diff-block");
  expect(markup).toContain("max-h-72");
  expect(markup).toContain("viewer-diff-line-file");
  expect(markup).toContain("viewer-diff-line-hunk");
  expect(markup).toContain("viewer-diff-line-remove");
  expect(markup).toContain("viewer-diff-line-add");
  expect(markup).toContain("--- a/src/app.ts");
  expect(markup).toContain("+new line");
  expect(markup).toContain("viewer-code-block");
  expect(markup).toContain("changed src/app.ts without unified diff markers");
});

test("viewer shell keeps tool-only groups bounded by original trail adjacency", () => {
  const events: ViewerEvent[] = [
    toolCallEvent(2, "01HEVTA0000000000000000001", "file_search"),
    toolResultEvent(3, "01HEVTA0000000000000000002", "01HEVTA0000000000000000001"),
    {
      body: "Separated by agent text.",
      id: "01HEVTA0000000000000000003",
      kind: "agent",
      line: 4,
      meta: [],
      ts: "2026-05-17T14:00:09.000Z",
      title: "Agent message",
      type: "agent_message",
    },
    toolCallEvent(5, "01HEVTA0000000000000000004", "file_read"),
    toolResultEvent(6, "01HEVTA0000000000000000005", "01HEVTA0000000000000000004"),
    toolCallEvent(7, "01HEVTA0000000000000000006", "file_write"),
    toolResultEvent(8, "01HEVTA0000000000000000007", "01HEVTA0000000000000000006"),
  ];

  const items = buildTranscriptItemsForViewer(events, {
    agent: false,
    thinking: false,
    tool: true,
    user: false,
  });

  expect(items).toHaveLength(2);
  expect(items[0]?.kind).toBe("tool");
  expect(items[1]?.kind).toBe("tool_group");
  if (items[1]?.kind !== "tool_group") throw new Error("expected second item to be tool group");
  expect(items[1].items).toHaveLength(2);
});

test("viewer shell renders user messages as safe markdown", async () => {
  const seed = await seedSharedTrailRecords([
    {
      type: "user_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: {
        text: "**Optimize** the `reducer` with [docs](https://example.com) <script>alert(1)</script>",
      },
    },
  ]);
  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/user-markdown",
    }),
  });

  const markup = renderToStaticMarkup(createElement(ViewerShell, { model }));

  expect(markup).toContain("<strong>Optimize</strong>");
  expect(markup).toContain("<code>reducer</code>");
  expect(markup).toContain('<a href="https://example.com">docs</a>');
  expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(markup).not.toContain("<script>");
});

test("viewer shell renders redacted local path markdown links", async () => {
  const seed = await seedSharedTrailRecords([
    {
      type: "user_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: {
        text: "[$tdd](<home>/.agents/skills/tdd/SKILL.md) #221",
      },
    },
  ]);
  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/redacted-link",
    }),
  });

  const markup = renderToStaticMarkup(createElement(ViewerShell, { model }));

  expect(markup).toContain('href="#"');
  expect(markup).toContain('class="viewer-dead-link"');
  expect(markup).toContain('aria-disabled="true"');
  expect(markup).toContain('aria-label="Unavailable link"');
  expect(markup).toContain('tabindex="-1"');
  expect(markup).toContain('title="Unavailable redacted link"');
  expect(markup).toContain("$tdd</a> #221");
});

test("viewer shell sidebar state waits for scroll settle", () => {
  expect(shouldCommitSidebarActiveState("manual-active-change")).toBe(false);
  expect(shouldCommitSidebarActiveState("manual-scroll-idle")).toBe(true);
  expect(shouldCommitSidebarActiveState("programmatic-settle")).toBe(true);
  expect(shouldCenterSidebar("manual-active-change")).toBe(false);
  expect(shouldCenterSidebar("manual-scroll-idle")).toBe(true);
  expect(shouldCenterSidebar("programmatic-settle")).toBe(true);
  expect(resolveProgrammaticSettledItem("event-2", "event-1", ["event-1", "event-2"])).toBe(
    "event-2",
  );
  expect(resolveProgrammaticSettledItem(null, "event-1", ["event-1", "event-2"])).toBe("event-1");
  expect(resolveProgrammaticSettledItem(null, "event-3", ["event-1", "event-2"])).toBe(null);
  expect(isScrollInterruptionKey("PageDown")).toBe(true);
  expect(isScrollInterruptionKey("a")).toBe(false);
});

test("viewer shell sidebar click hash update uses pushState when available", () => {
  const pushed: string[] = [];
  const pushRuntime = {
    history: {
      pushState: (_data: unknown, _unused: string, url?: string | URL | null) => {
        pushed.push(String(url));
        pushRuntime.location.hash = String(url);
      },
    },
    location: { hash: "" },
  };

  expect(setHashForSidebarTarget("event-9", pushRuntime)).toBe("pushState");
  expect(pushed).toEqual(["#event-9"]);
  expect(pushRuntime.location.hash).toBe("#event-9");
  expect(setHashForSidebarTarget("event-9", pushRuntime)).toBe("none");

  const hashRuntime = { location: { hash: "" } };
  expect(setHashForSidebarTarget("event-16", hashRuntime)).toBe("hash");
  expect(hashRuntime.location.hash).toBe("#event-16");
});

test("viewer shell css keeps open-summary borders locally owned", () => {
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

  expect(styles).not.toContain(".viewer-tool-group-details[open] > .viewer-tool-group-summary");
  expect(styles).not.toContain(".viewer-tool-details[open] > .viewer-tool-summary");
  expect(styles).not.toContain(".viewer-result-details[open] > .viewer-result-summary");
  expect(styles).toContain(".viewer-tool-group-stack");
  expect(styles).toContain('.viewer-message-markdown a[href="#"]');
});

test("viewer shell renders agent responses and thinking as safe markdown", async () => {
  const seed = await seedSharedTrailRecords([
    {
      type: "agent_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: {
        text: "**Respond** with `markdown` and [docs](https://example.com) <script>alert(1)</script>",
      },
    },
    {
      type: "agent_thinking",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-17T14:00:06.000Z",
      payload: {
        text: "**Think** through `state` before acting.",
      },
    },
  ]);
  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/agent-markdown",
    }),
  });

  const markup = renderToStaticMarkup(createElement(ViewerShell, { model }));

  expect(markup).toContain("Agent_reply");
  expect(markup).toContain("Thought");
  expect(markup).toContain('aria-label="Agent thinking messages"');
  expect(markup).toContain("<strong>Respond</strong>");
  expect(markup).toContain("<strong>Think</strong>");
  expect(markup).toContain("<code>markdown</code>");
  expect(markup).toContain("<code>state</code>");
  expect(markup).toContain('<a href="https://example.com">docs</a>');
  expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(markup).not.toContain("<script>");
});

test("viewer shell renders an empty filtered event state", async () => {
  const seed = await seedSharedTrailPayload({ overrideHash: "0".repeat(64) });
  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/empty-filter",
    }),
  });
  if (model.status !== "loaded") throw new Error("expected loaded model");

  const markup = renderToStaticMarkup(
    createElement(TranscriptPane, { items: [], model, onScrollRoot: () => undefined }),
  );

  expect(markup).toContain("viewer-empty-state");
  expect(markup).toContain("No events match selected filters.");
});

function toolCallEvent(line: number, id: string, tool: string): ViewerEvent {
  return {
    body: tool,
    id,
    kind: "tool_call",
    line,
    meta: [],
    ts: "2026-05-17T14:00:07.000Z",
    title: `Tool call: ${tool}`,
    type: "tool_call",
  };
}

function toolResultEvent(line: number, id: string, forId: string): ViewerEvent {
  return {
    body: `${forId} output`,
    id,
    kind: "tool_result",
    line,
    meta: [{ label: "for", value: forId }],
    status: "ok",
    ts: "2026-05-17T14:00:08.000Z",
    title: "Tool result: ok",
    type: "tool_result",
  };
}

test("viewer shell renders validation diagnostics for error state", async () => {
  const invalidJsonl = '{"type":"session","schema_version":"0.1.0"}\n';
  const invalidPayloadText = gzipSync(Buffer.from(invalidJsonl, "utf8")).toString("base64");
  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: "invalid.trail.jsonl.gz.b64",
      payloadText: invalidPayloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/invalid",
    }),
  });

  const markup = renderToStaticMarkup(createElement(ViewerShell, { model }));

  expect(markup).toContain("Shared trail failed reader-tolerant validation.");
  expect(markup).toContain("Diagnostics");
  expect(markup).toContain("required");
});
