import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { browserStateFromInput } from "./session-browser-state.ts";
import {
  mountSessionBrowser,
  renderBrowserFrame,
  type SessionBrowserRow,
  toggleScopeSafely,
} from "./session-browser-tui.ts";

const rows: SessionBrowserRow[] = [
  {
    state: "source",
    source_id: "sess-alpha",
    source_agent: "codex",
    source_cwd: "/work/alpha",
    source_modified_at: "2026-05-18T14:00:00.000Z",
    source_path: "/tmp/alpha.jsonl",
    content_hash: null,
    registered_agent: null,
    registered_cwd: null,
    registered_at: null,
    registered_source_path: null,
    registered_kind: null,
    agent: "codex",
    cwd: "/work/alpha",
    latest_at: "2026-05-18T14:00:00.000Z",
    display_name: "First source message for alpha",
  },
  {
    state: "registered",
    source_id: null,
    source_agent: null,
    source_cwd: null,
    source_modified_at: null,
    source_path: null,
    content_hash: "a".repeat(64),
    registered_agent: "claude-code",
    registered_cwd: "/work/beta",
    registered_at: "2026-05-17T14:00:00.000Z",
    registered_source_path: "/tmp/beta.trail.jsonl",
    registered_kind: "session",
    agent: "claude-code",
    cwd: "/work/beta",
    latest_at: "2026-05-17T14:00:00.000Z",
    display_name: "Registered Trail Name",
  },
];

function sourceRow(index: number): SessionBrowserRow {
  const suffix = String(index).padStart(2, "0");
  return {
    state: "source",
    source_id: `sess-${suffix}`,
    source_agent: "codex",
    source_cwd: `/work/row-${suffix}`,
    source_modified_at: `2026-05-18T14:${suffix}:00.000Z`,
    source_path: `/tmp/row-${suffix}.jsonl`,
    content_hash: null,
    registered_agent: null,
    registered_cwd: null,
    registered_at: null,
    registered_source_path: null,
    registered_kind: null,
    agent: "codex",
    cwd: `/work/row-${suffix}`,
    latest_at: `2026-05-18T14:${suffix}:00.000Z`,
  };
}

function compactLocalDate(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

test("browser frame renders empty state", () => {
  const frame = renderBrowserFrame({ rows: [], warnings: [] }, { width: 120 });

  expect(frame).toContain("AGENT TRAIL BROWSER");
  expect(frame).toContain("TITLE");
  expect(frame).toContain("AGENT");
  expect(frame).toContain("DATE");
  expect(frame).toContain("TRAIL");
  expect(frame).toContain("PREVIEW");
  expect(frame).toContain("No sessions found");
  expect(frame).toContain("No row selected");
  expect(frame.split("\n")).toHaveLength(24);
});

test("browser frame renders session table columns and preview details", () => {
  const frame = renderBrowserFrame(
    { rows, warnings: [], scope: { mode: "cwd", label: "agent-trail" } },
    { width: 120, height: 24 },
  );

  expect(frame).toContain("PROJECT agent-trail");
  expect(frame).toContain("SEARCH -");
  expect(frame).toContain("AGENT all");
  expect(frame).toContain("ROWS 2  FILTERED 2");
  expect(frame).not.toContain("status:");
  expect(frame).toContain("#");
  expect(frame).toContain("DATE");
  expect(frame).toContain("TITLE");
  expect(frame).not.toContain("PROJECT│");
  expect(frame).not.toContain("┼");
  expect(frame).toContain("01");
  expect(frame).toContain("02");
  expect(frame).toContain("First source message for alpha");
  expect(frame).toContain("codex");
  expect(frame).toContain(compactLocalDate(rows[0]?.latest_at ?? ""));
  expect(frame).toContain("NO");
  expect(frame).toContain("Registered Trail Name");
  expect(frame).toContain("claude-code");
  expect(frame).toContain(compactLocalDate(rows[1]?.latest_at ?? ""));
  expect(frame).toContain("YES");
  expect(frame).toContain("NAME First source message for alpha");
  expect(frame).toContain("TRAIL NO");
  expect(frame).toContain("enter open");
  expect(frame).toContain("r resume");
  expect(frame).toContain("a all");
  expect(frame).toContain("t trail");
  expect(frame).toContain("g agent");
  expect(frame).not.toContain("name:");
  expect(frame).not.toContain("trail:");
});

test("browser agent shortcut cycles agent filters", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    const app = mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    setup.mockInput.pressKey("g");
    await setup.renderOnce();

    expect(app.state().agentFilter).toBe("claude-code");
    expect(setup.captureCharFrame()).toContain("AGENT claude-code");
    expect(setup.captureCharFrame()).toContain("FILTERED 1");
    expect(setup.captureCharFrame()).toContain("Registered Trail Name");
    expect(setup.captureCharFrame()).not.toContain("First source message for alpha");

    setup.mockInput.pressKey("g");
    await setup.renderOnce();

    expect(app.state().agentFilter).toBe("codex");
    expect(setup.captureCharFrame()).toContain("AGENT codex");
    expect(setup.captureCharFrame()).toContain("FILTERED 1");
    expect(setup.captureCharFrame()).toContain("First source message for alpha");
    expect(setup.captureCharFrame()).not.toContain("Registered Trail Name");

    setup.mockInput.pressKey("g");
    await setup.renderOnce();

    expect(app.state().agentFilter).toBeNull();
    expect(setup.captureCharFrame()).toContain("AGENT all");
    expect(setup.captureCharFrame()).toContain("FILTERED 2");
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  }
});

test("browser resume key shows disabled reason when handler is absent", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    setup.mockInput.pressKey("r");
    await setup.renderOnce();

    expect(setup.captureCharFrame()).toContain("Resume unavailable");
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  }
});

test("browser resume key destroys TUI and returns resume result", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    const app = mountSessionBrowser(setup.renderer, {
      rows,
      warnings: [],
      onResume: async () => ({ exitCode: 7, stdout: "", stderr: "resume exited 7\n" }),
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("r");
    const result = await app.waitForExit();

    expect(setup.renderer.isDestroyed).toBe(true);
    expect(result).toEqual({ exitCode: 7, stdout: "", stderr: "resume exited 7\n" });
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  }
});

test("browser resume key returns clear error when handoff fails", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    const app = mountSessionBrowser(setup.renderer, {
      rows,
      warnings: [],
      onResume: async (_row, context) => {
        context?.beforeSpawn();
        throw new Error("spawn failed");
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("r");
    const result = await app.waitForExit();

    expect(setup.renderer.isDestroyed).toBe(true);
    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "Resume failed: spawn failed\n" });
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  }
});

test("browser frame renders all scope in header", () => {
  const frame = renderBrowserFrame(
    { rows, warnings: [], scope: { mode: "all", label: "all" } },
    { width: 150, height: 24 },
  );

  expect(frame).toContain("PROJECT all");
  expect(frame).toContain("PROJECT");
  const sourceLine = frame.split("\n").find((line) => line.includes("First source"));
  const registeredLine = frame.split("\n").find((line) => line.includes("Registered Trail Name"));
  expect(sourceLine).toContain("alpha");
  expect(sourceLine).not.toContain("/work/alpha");
  expect(registeredLine).toContain("beta");
  expect(registeredLine).not.toContain("/work/beta");
});

test("browser frame wraps long preview fields instead of ellipsizing them", () => {
  const frame = renderBrowserFrame(
    {
      rows: [
        {
          ...rows[0],
          display_name:
            "Very long session title that should wrap into the preview pane instead of using ellipsis",
        } as SessionBrowserRow,
      ],
      warnings: [],
    },
    { width: 120, height: 24 },
  );

  expect(frame).toContain("NAME Very long session title");
  expect(frame).toContain("pane instead of using ellipsis");
  expect(frame).not.toContain("NAME Very long session title...");
});

test("browser frame lets table title use available column width beyond 80 characters", () => {
  const title =
    "This table title is intentionally longer than eighty characters and should keep rendering past that earlier fixed cap";
  const frame = renderBrowserFrame(
    {
      rows: [
        {
          ...rows[0],
          display_name: title,
        } as SessionBrowserRow,
      ],
      warnings: [],
    },
    { width: 180, height: 24 },
  );

  expect(frame).toContain("This table title is intentionally longer than eighty characters");
  expect(frame).toContain("earlier fixed cap");
});

test("browser frame caps preview name field at three lines", () => {
  const frame = renderBrowserFrame(
    {
      rows: [
        {
          ...rows[0],
          display_name:
            "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty",
        } as SessionBrowserRow,
      ],
      warnings: [],
    },
    { width: 120, height: 24 },
  );
  const nameLines = frame
    .split("\n")
    .filter((line) => line.includes("│ NAME ") || line.includes("│      "));

  expect(nameLines.slice(0, 3)).toHaveLength(3);
  expect(frame).not.toContain("seventeen eighteen");
});

test("browser frame omits body row rules and separates table from preview", () => {
  const frame = renderBrowserFrame(
    { rows: [rows[0] as SessionBrowserRow], warnings: [] },
    {
      width: 120,
      height: 16,
    },
  );
  const lines = frame.split("\n");
  const headerIndex = lines.findIndex((line) => line.includes("TITLE"));
  const bottomRuleIndex = lines.findIndex((line) => line.includes("└"));
  const bodyLines = lines.slice(headerIndex + 1, bottomRuleIndex);

  expect(frame).toContain("┐  ┌");
  expect(frame).toContain("│  │");
  expect(lines[headerIndex + 1]).not.toContain("├");
  expect(bodyLines.some((line) => line.includes("├"))).toBe(false);
  expect(bodyLines.some((line) => line.includes("┼"))).toBe(false);
});

test("browser TUI renders rows and destroys cleanly", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    const app = mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("AGENT TRAIL BROWSER");
    expect(frame).toContain("First sour");
    expect(frame).toContain("NO");

    setup.mockInput.pressKey("q");
    await app.waitForExit();
    expect(setup.renderer.isDestroyed).toBe(true);
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  }
});

test("browser navigation updates selected row preview", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    setup.mockInput.pressArrow("down");
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).not.toContain(">");
    expect(frame).toContain("Registered Tra");
    expect(frame).toContain("AGENT claude-code");
    expect(frame).toContain("TRAIL YES");
    expect(frame).toContain("STATE registered");
    expect(frame).toContain("ID aaaaaaaaaaaa");
  } finally {
    setup.renderer.destroy();
  }
});

test("browser navigation keeps selected row visible after first page", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    const manyRows = Array.from({ length: 25 }, (_value, index) => sourceRow(index));
    mountSessionBrowser(setup.renderer, { rows: manyRows, warnings: [] });
    await setup.renderOnce();

    for (let i = 0; i < 24; i += 1) {
      setup.mockInput.pressArrow("down");
    }
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).not.toContain(">");
    expect(frame).toContain("row-24.jsonl");
    expect(frame).toContain("CWD /work/row-24");
    expect(frame).not.toContain("row-00.jsonl");
  } finally {
    setup.renderer.destroy();
  }
});

test("browser search filters rows and keeps deterministic selection", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    setup.mockInput.pressKey("/");
    await setup.mockInput.typeText("beta");
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("FILTERED 1");
    expect(frame).toContain("SEARCH beta_");
    expect(frame).not.toContain(">");
    expect(frame).toContain("Registered Tra");
    expect(frame).toContain("AGENT claude-code");
    expect(frame).not.toContain("First source");
  } finally {
    setup.renderer.destroy();
  }
});

test("browser trail shortcut filters registered and unregistered rows", async () => {
  const setup = await createTestRenderer({ width: 130, height: 24 });
  try {
    mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    setup.mockInput.pressKey("t");
    await setup.renderOnce();

    let frame = setup.captureCharFrame();
    expect(frame).toContain("TRAIL YES");
    expect(frame).toContain("FILTERED 1");
    expect(frame).toContain("Registered Tra");
    expect(frame).not.toContain("First source message for alpha");

    setup.mockInput.pressKey("t");
    await setup.renderOnce();

    frame = setup.captureCharFrame();
    expect(frame).toContain("TRAIL NO");
    expect(frame).toContain("FILTERED 1");
    expect(frame).toContain("First source message for alpha");
    expect(frame).not.toContain("Registered Tra");

    setup.mockInput.pressKey("t");
    await setup.renderOnce();

    frame = setup.captureCharFrame();
    expect(frame).toContain("TRAIL all");
    expect(frame).toContain("FILTERED 2");
  } finally {
    setup.renderer.destroy();
  }
});

test("browser scope shortcut reloads rows and updates header", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    mountSessionBrowser(setup.renderer, {
      rows: [rows[0] as SessionBrowserRow],
      warnings: [],
      scope: { mode: "cwd", label: "alpha" },
      onToggleScope: async (nextScope) => ({
        rows,
        warnings: [],
        scope: { mode: nextScope, label: nextScope === "all" ? "all" : "alpha" },
      }),
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("PROJECT all");
    expect(frame).toContain("PROJECT");
    expect(frame).toContain("ROWS 2");
  } finally {
    setup.renderer.destroy();
  }
});

test("browser scope toggle handles reload rejection and restores loading state", async () => {
  const state = browserStateFromInput({
    rows: [rows[0] as SessionBrowserRow],
    warnings: [],
    scope: { mode: "cwd", label: "alpha" },
    onToggleScope: async () => {
      throw new Error("reload failed");
    },
  });
  let updates = 0;

  await toggleScopeSafely(state, () => {
    updates += 1;
  });

  expect(updates).toBe(2);
  expect(state.loading).toBe(false);
  expect(state.scope).toEqual({ mode: "cwd", label: "alpha" });
  expect(state.rows).toEqual([rows[0] as SessionBrowserRow]);
});

test("browser scope toggle refreshes row action handlers from reloaded input", async () => {
  const state = browserStateFromInput({
    rows: [rows[0] as SessionBrowserRow],
    warnings: [],
    scope: { mode: "cwd", label: "alpha" },
    onShare: async () => ({ message: "old share" }),
    onExport: async () => ({ message: "old export" }),
    onCopyUrl: async () => ({ message: "old copy" }),
    onToggleScope: async () => ({
      rows: [rows[1] as SessionBrowserRow],
      warnings: [],
      scope: { mode: "all", label: "all" },
      onShare: async () => ({ message: "new share" }),
      onExport: async () => ({ message: "new export" }),
      onCopyUrl: async () => ({ message: "new copy" }),
    }),
  });

  await toggleScopeSafely(state, () => {});

  expect(await state.onShare?.(rows[1] as SessionBrowserRow)).toEqual({ message: "new share" });
  expect(await state.onExport?.(rows[1] as SessionBrowserRow)).toEqual({ message: "new export" });
  expect(await state.onCopyUrl?.("https://agent-trail.dev/view/gist/new")).toEqual({
    message: "new copy",
  });
});

test("browser search mode ignores non-character keys without crashing", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    setup.mockInput.pressKey("/");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("SEARCH _");
    expect(frame).not.toContain(">");
    expect(frame).toContain("First sour");
  } finally {
    setup.renderer.destroy();
  }
});

test("browser frame collapses preview on narrow terminals", () => {
  const frame = renderBrowserFrame({ rows, warnings: [] }, { width: 104, height: 8 });
  const lines = frame.split("\n");

  expect(lines).toHaveLength(8);
  expect(frame).toContain("TITLE");
  expect(frame).toContain("TRAIL");
  expect(frame).not.toContain("PREVIEW");
  expect(frame).not.toContain("│PREVIEW");
  expect(lines.every((line) => line.length <= 104)).toBe(true);
});

test("browser frame strips terminal control sequences from rendered content", () => {
  const state = browserStateFromInput({
    rows: [
      {
        ...sourceRow(0),
        source_id: "evil\x1b]52;c;secret\x07-id",
        agent: "codex\x1b[31m-red",
        cwd: "/work/\x1b[31mred\nnext",
        source_path: "/tmp/\x1bPpayload\x1b\\session.jsonl",
      },
    ],
    warnings: ["warning: \x1b]52;c;secret\x07skip\rline"],
  });
  state.actionMessage = "status \x1b]52;c;secret\x07ok";
  const frame = renderBrowserFrame(state, { width: 120 });

  expect(frame).not.toContain("\x1b");
  expect(frame).not.toContain("]52");
  expect(frame).not.toContain("[31m");
  expect(frame).not.toContain("payload");
  expect(frame).toContain("codex-red");
  expect(frame).toContain("/work/red next");
  expect(frame).toContain("warning: skip line");
  expect(frame).toContain("STATUS status ok");
});

test("enter opens selected row placeholder", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    setup.mockInput.pressEnter();
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Open placeholder");
    expect(frame).toContain("sess-alpha");
  } finally {
    setup.renderer.destroy();
  }
});

test("enter opens registered row placeholder by content hash", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Open placeholder");
    expect(frame).toContain("aaaaaaaaaaaa");
  } finally {
    setup.renderer.destroy();
  }
});

test("share shortcut dispatches selected source row and records share URL", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    const calls: SessionBrowserRow[] = [];
    mountSessionBrowser(setup.renderer, {
      rows,
      warnings: [],
      onShare: async (row, context) => {
        if ((await context?.confirm("Share selected trail?")) !== true) {
          return { message: "Share cancelled." };
        }
        calls.push(row);
        return {
          message: "Shared https://agent-trail.dev/view/gist/sourceid",
          url: "https://agent-trail.dev/view/gist/sourceid",
        };
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    expect(calls).toEqual([]);
    expect(setup.captureCharFrame()).toContain("Confirm share");

    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();

    expect(calls.map((row) => row.source_id)).toEqual(["sess-alpha"]);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Share created");
    expect(frame).toContain("/sourceid");
  } finally {
    setup.renderer.destroy();
  }
});

test("share modal switches from confirmation to uploading progress before showing link", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  let resolveUpload: ((value: { message: string; url: string }) => void) | undefined;
  const longUrl = `https://agent-trail.dev/view/gist/${"a".repeat(80)}XYZTAIL`;
  try {
    mountSessionBrowser(setup.renderer, {
      rows,
      warnings: [],
      onShare: async (_row, context) => {
        if ((await context?.confirm("Share selected trail?")) !== true) {
          return { message: "Share cancelled." };
        }
        return await new Promise((resolve) => {
          resolveUpload = resolve;
        });
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Confirm share");

    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("Uploading share");
    expect(frame).toContain("Uploading gist");
    expect(frame).not.toContain("[");
    expect(frame).not.toContain("Uploading...");
    expect(frame).not.toContain("Share created");

    resolveUpload?.({
      message: `Shared ${longUrl}`,
      url: longUrl,
    });
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();

    frame = setup.captureCharFrame();
    expect(frame).toContain("Share created");
    expect(frame).toContain("XYZTAIL");
  } finally {
    setup.renderer.destroy();
  }
});

test("share shortcut reuses prior URL for the same row without confirming again", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    let shareCalls = 0;
    mountSessionBrowser(setup.renderer, {
      rows,
      warnings: [],
      onShare: async (_row, context) => {
        shareCalls += 1;
        if ((await context?.confirm("Share selected trail?")) !== true) {
          return { message: "Share cancelled." };
        }
        return {
          message: "Shared https://agent-trail.dev/view/gist/reuseid",
          url: "https://agent-trail.dev/view/gist/reuseid",
        };
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Confirm share");
    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("/reuseid");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    setup.mockInput.pressKey("s");
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(shareCalls).toBe(1);
    expect(frame).toContain("Share created");
    expect(frame).toContain("/reuseid");
    expect(frame).not.toContain("Confirm share");
  } finally {
    setup.renderer.destroy();
  }
});

test("share shortcut does not reuse a URL for a different source path with the same source id", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  const first = {
    ...(rows[0] as SessionBrowserRow),
    source_id: "duplicate-source",
    source_path: "/tmp/one.jsonl",
    display_name: "First duplicate source",
  } as SessionBrowserRow;
  const second = {
    ...(rows[0] as SessionBrowserRow),
    source_id: "duplicate-source",
    source_path: "/tmp/two.jsonl",
    display_name: "Second duplicate source",
    latest_at: "2026-05-18T14:01:00.000Z",
  } as SessionBrowserRow;

  try {
    const sharedPaths: string[] = [];
    mountSessionBrowser(setup.renderer, {
      rows: [first, second],
      warnings: [],
      onShare: async (row, context) => {
        if ((await context?.confirm("Share selected trail?")) !== true) {
          return { message: "Share cancelled." };
        }
        sharedPaths.push(row.source_path ?? "");
        const id = row.source_path === "/tmp/one.jsonl" ? "oneid" : "twoid";
        return {
          message: `Shared https://agent-trail.dev/view/gist/${id}`,
          url: `https://agent-trail.dev/view/gist/${id}`,
        };
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("/oneid");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Confirm share");
    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();

    expect(sharedPaths).toEqual(["/tmp/one.jsonl", "/tmp/two.jsonl"]);
    expect(setup.captureCharFrame()).toContain("/twoid");
  } finally {
    setup.renderer.destroy();
  }
});

test("share shortcut does not reuse a cached URL when source is newer than registration", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  const staleRow = {
    ...(rows[0] as SessionBrowserRow),
    state: "source+registered",
    content_hash: "b".repeat(64),
    registered_at: "2026-05-18T14:00:00.000Z",
    source_modified_at: "2026-05-18T14:00:00.000Z",
  } as SessionBrowserRow;
  const changedRow = {
    ...staleRow,
    source_modified_at: "2026-05-18T14:01:00.000Z",
  } as SessionBrowserRow;

  try {
    let shareCalls = 0;
    mountSessionBrowser(setup.renderer, {
      rows: [staleRow],
      warnings: [],
      onShare: async (row, context) => {
        shareCalls += 1;
        if ((await context?.confirm("Share selected trail?")) !== true) {
          return { message: "Share cancelled." };
        }
        return {
          message: `Shared https://agent-trail.dev/view/gist/${shareCalls}`,
          rows: shareCalls === 1 ? [changedRow] : [row],
          url: `https://agent-trail.dev/view/gist/${shareCalls}`,
        };
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("/1");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Confirm share");
    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();

    expect(shareCalls).toBe(2);
    expect(setup.captureCharFrame()).toContain("/2");
  } finally {
    setup.renderer.destroy();
  }
});

test("share shortcut does not reuse a cached URL when source timestamp is malformed", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  const stableRow = {
    ...(rows[0] as SessionBrowserRow),
    state: "source+registered",
    content_hash: "b".repeat(64),
    registered_at: "2026-05-18T14:00:00.000Z",
    source_modified_at: "2026-05-18T14:00:00.000Z",
  } as SessionBrowserRow;
  const malformedRow = {
    ...stableRow,
    source_modified_at: "not-a-date",
  } as SessionBrowserRow;

  try {
    let shareCalls = 0;
    mountSessionBrowser(setup.renderer, {
      rows: [stableRow],
      warnings: [],
      onShare: async (row, context) => {
        shareCalls += 1;
        if ((await context?.confirm("Share selected trail?")) !== true) {
          return { message: "Share cancelled." };
        }
        return {
          message: `Shared https://agent-trail.dev/view/gist/malformed-${shareCalls}`,
          rows: shareCalls === 1 ? [malformedRow] : [row],
          url: `https://agent-trail.dev/view/gist/malformed-${shareCalls}`,
        };
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Confirm share");
    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();

    expect(shareCalls).toBe(2);
    expect(setup.captureCharFrame()).toContain("/malformed-2");
  } finally {
    setup.renderer.destroy();
  }
});

test("share shortcut does not reuse a cached URL when source revision is unknown", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  const stableRow = {
    ...(rows[0] as SessionBrowserRow),
    state: "source+registered",
    content_hash: "b".repeat(64),
    registered_at: "2026-05-18T14:00:00.000Z",
    source_modified_at: "2026-05-18T14:00:00.000Z",
  } as SessionBrowserRow;
  const unknownRevisionRow = {
    ...stableRow,
    source_modified_at: null,
  } as SessionBrowserRow;

  try {
    let shareCalls = 0;
    mountSessionBrowser(setup.renderer, {
      rows: [stableRow],
      warnings: [],
      onShare: async (row, context) => {
        shareCalls += 1;
        if ((await context?.confirm("Share selected trail?")) !== true) {
          return { message: "Share cancelled." };
        }
        return {
          message: `Shared https://agent-trail.dev/view/gist/unknown-${shareCalls}`,
          rows: shareCalls === 1 ? [unknownRevisionRow] : [row],
          url: `https://agent-trail.dev/view/gist/unknown-${shareCalls}`,
        };
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Confirm share");
    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();

    expect(shareCalls).toBe(2);
    expect(setup.captureCharFrame()).toContain("/unknown-2");
  } finally {
    setup.renderer.destroy();
  }
});

test("share shortcut dispatches selected registered row by content hash", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    const calls: SessionBrowserRow[] = [];
    mountSessionBrowser(setup.renderer, {
      rows,
      warnings: [],
      onShare: async (row, context) => {
        if ((await context?.confirm("Share selected trail?")) !== true) {
          return { message: "Share cancelled." };
        }
        calls.push(row);
        return { message: "Shared registered" };
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressArrow("down");
    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    expect(calls).toEqual([]);
    expect(setup.captureCharFrame()).toContain("Confirm share");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();

    expect(calls.map((row) => row.content_hash)).toEqual(["a".repeat(64)]);
    expect(setup.captureCharFrame()).toContain("Shared registered");
  } finally {
    setup.renderer.destroy();
  }
});

test("share confirmation dialog can cancel before upload dispatch", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    const calls: SessionBrowserRow[] = [];
    mountSessionBrowser(setup.renderer, {
      rows,
      warnings: [],
      onShare: async (row, context) => {
        if ((await context?.confirm("Share selected trail?")) !== true) {
          return { message: "Share cancelled." };
        }
        calls.push(row);
        return { message: "Shared" };
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Y/Enter share");

    setup.mockInput.pressKey("n");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();

    expect(calls).toEqual([]);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Share cancelled");
    expect(frame).not.toContain("Confirm share");
  } finally {
    setup.renderer.destroy();
  }
});

test("export shortcut dispatches selected rows", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    const calls: string[] = [];
    mountSessionBrowser(setup.renderer, {
      rows,
      warnings: [],
      onExport: async (row) => {
        calls.push(row.source_id ?? row.content_hash ?? "");
        return { message: "Exported" };
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("e");
    await setup.renderOnce();
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressKey("e");
    await setup.renderOnce();
    await setup.renderOnce();

    expect(calls).toEqual(["sess-alpha", "a".repeat(64)]);
  } finally {
    setup.renderer.destroy();
  }
});

test("copy shortcut requires a shared URL and dispatches copy handler", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24 });
  try {
    const copied: string[] = [];
    mountSessionBrowser(setup.renderer, {
      rows,
      warnings: [],
      onShare: async (_row, context) => {
        if ((await context?.confirm("Share selected trail?")) !== true) {
          return { message: "Share cancelled." };
        }
        return {
          message: "Shared",
          url: "https://agent-trail.dev/view/gist/copyid",
        };
      },
      onCopyUrl: async (url) => {
        copied.push(url);
        return { message: "Copied URL" };
      },
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("No share URL to copy");

    setup.mockInput.pressKey("s");
    await setup.renderOnce();
    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Share created");

    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.renderOnce();

    expect(copied).toEqual(["https://agent-trail.dev/view/gist/copyid"]);
    expect(setup.captureCharFrame()).toContain("Copied URL");
  } finally {
    setup.renderer.destroy();
  }
});

test("ctrl-c quits and destroys cleanly", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    const app = mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    setup.mockInput.pressCtrlC();
    await app.waitForExit();

    expect(setup.renderer.isDestroyed).toBe(true);
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  }
});

test("browser returns warnings after alternate-screen exit", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    const app = mountSessionBrowser(setup.renderer, {
      rows,
      warnings: ["warning: \x1b]52;c;secret\x07source\rfailed"],
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("q");
    const result = await app.waitForExit();

    expect(result.stderr).toBe("warning: source failed\n");
    expect(result.stderr).not.toContain("\x1b");
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  }
});

test("external renderer destroy resolves browser exit", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const app = mountSessionBrowser(setup.renderer, { rows, warnings: [] });
  await setup.renderOnce();

  setup.renderer.destroy();
  const result = await app.waitForExit();

  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  expect(setup.renderer.isDestroyed).toBe(true);
});
