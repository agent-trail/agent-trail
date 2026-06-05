import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import {
  mountSessionBrowser,
  renderBrowserFrame,
  type SessionBrowserRow,
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

test("browser frame renders empty state", () => {
  const frame = renderBrowserFrame({ rows: [], warnings: [] });

  expect(frame).toContain("Agent Trail Browser");
  expect(frame).toContain("No sessions found");
});

test("browser TUI renders rows and destroys cleanly", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    const app = mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Agent Trail Browser");
    expect(frame).toContain("sess-alpha");
    expect(frame).toContain("claude-code");

    setup.mockInput.pressKey("q");
    await app.waitForExit();
    expect(setup.renderer.isDestroyed).toBe(true);
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  }
});

test("browser navigation updates selected row preview", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    setup.mockInput.pressArrow("down");
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("> registered claude-code");
    expect(frame).toContain("id: aaaaaaaaaaaa");
  } finally {
    setup.renderer.destroy();
  }
});

test("browser navigation keeps selected row visible after first page", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    const manyRows = Array.from({ length: 13 }, (_value, index) => sourceRow(index));
    mountSessionBrowser(setup.renderer, { rows: manyRows, warnings: [] });
    await setup.renderOnce();

    for (let i = 0; i < 12; i += 1) {
      setup.mockInput.pressArrow("down");
    }
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("> source codex /work/row-12");
    expect(frame).not.toContain("sess-00");
  } finally {
    setup.renderer.destroy();
  }
});

test("browser search filters rows and keeps deterministic selection", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    mountSessionBrowser(setup.renderer, { rows, warnings: [] });
    await setup.renderOnce();

    setup.mockInput.pressKey("/");
    await setup.mockInput.typeText("beta");
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Search: beta");
    expect(frame).toContain("> registered claude-code");
    expect(frame).not.toContain("sess-alpha");
  } finally {
    setup.renderer.destroy();
  }
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
    expect(frame).toContain("Search:  _");
    expect(frame).toContain("> source codex");
  } finally {
    setup.renderer.destroy();
  }
});

test("browser frame strips terminal control sequences from rendered content", () => {
  const frame = renderBrowserFrame({
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

  expect(frame).not.toContain("\x1b");
  expect(frame).not.toContain("]52");
  expect(frame).not.toContain("[31m");
  expect(frame).not.toContain("payload");
  expect(frame).toContain("codex-red");
  expect(frame).toContain("/work/red next");
  expect(frame).toContain("warning: skip line");
});

test("enter opens selected row placeholder", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
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
  const setup = await createTestRenderer({ width: 80, height: 24 });
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
      warnings: ["warning: source failed"],
    });
    await setup.renderOnce();

    setup.mockInput.pressKey("q");
    const result = await app.waitForExit();

    expect(result.stderr).toBe("warning: source failed\n");
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
