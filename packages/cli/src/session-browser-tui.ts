import { type CliRenderer, createCliRenderer, type KeyEvent, TextRenderable } from "@opentui/core";
import type { CliResult } from "./command.ts";

export type SessionBrowserRow = {
  state: "source" | "registered" | "source+registered";
  source_id: string | null;
  source_agent: string | null;
  source_cwd: string | null;
  source_modified_at: string | null;
  source_path: string | null;
  content_hash: string | null;
  registered_agent: string | null;
  registered_cwd: string | null;
  registered_at: string | null;
  registered_source_path: string | null;
  registered_kind: "session" | "trail" | null;
  agent: string | null;
  cwd: string | null;
  latest_at: string | null;
};

export type SessionBrowserTerminal = {
  isTTY?: boolean;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  width?: number;
  height?: number;
};

type SessionBrowserInput = {
  rows: SessionBrowserRow[];
  warnings: string[];
};

type BrowserState = SessionBrowserInput & {
  query: string;
  searchMode: boolean;
  selectedIndex: number;
  openedIdentity: string | null;
};

export type MountedSessionBrowser = {
  waitForExit: () => Promise<CliResult>;
  state: () => BrowserState;
};

const MISSING = "-";
const MAX_VISIBLE_ROWS = 12;

export async function runSessionBrowserTui(
  input: SessionBrowserInput,
  terminal: SessionBrowserTerminal = {},
): Promise<CliResult> {
  const renderer = await createCliRenderer({
    stdin: terminal.stdin,
    stdout: terminal.stdout,
    width: terminal.width,
    height: terminal.height,
    screenMode: "alternate-screen",
    consoleMode: "disabled",
    exitOnCtrlC: false,
    clearOnShutdown: true,
    useMouse: true,
  });
  try {
    const app = mountSessionBrowser(renderer, input);
    await renderer.idle();
    return await app.waitForExit();
  } catch (error) {
    if (!renderer.isDestroyed) renderer.destroy();
    throw error;
  }
}

export function mountSessionBrowser(
  renderer: CliRenderer,
  input: SessionBrowserInput,
): MountedSessionBrowser {
  const state: BrowserState = {
    rows: input.rows,
    warnings: input.warnings,
    query: "",
    searchMode: false,
    selectedIndex: 0,
    openedIdentity: null,
  };
  let resolveExit: (result: CliResult) => void;
  const exitPromise = new Promise<CliResult>((resolve) => {
    resolveExit = resolve;
  });
  const root = new TextRenderable(renderer, {
    content: renderBrowserFrame(state),
    width: "100%",
    height: "100%",
  });

  const update = () => {
    clampSelection(state);
    root.content = renderBrowserFrame(state);
    renderer.requestRender();
  };

  const quit = () => {
    renderer.keyInput.off("keypress", onKey);
    if (!renderer.isDestroyed) renderer.destroy();
    resolveExit({ exitCode: 0, stdout: "", stderr: "" });
  };

  const onKey = (key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      quit();
      return;
    }
    if (state.searchMode) {
      handleSearchKey(state, key);
      update();
      return;
    }
    if (key.name === "q") {
      quit();
      return;
    }
    if (key.name === "/" || key.sequence === "/") {
      state.searchMode = true;
      state.query = "";
      state.selectedIndex = 0;
      update();
      return;
    }
    if (key.name === "down" || key.name === "j") {
      state.selectedIndex += 1;
      update();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      state.selectedIndex -= 1;
      update();
      return;
    }
    if (key.name === "return") {
      const row = filteredRows(state)[state.selectedIndex];
      state.openedIdentity = row === undefined ? null : rowIdentity(row);
      update();
    }
  };

  renderer.root.add(root);
  renderer.keyInput.on("keypress", onKey);
  renderer.once("destroy", () => {
    renderer.keyInput.off("keypress", onKey);
    resolveExit({ exitCode: 0, stdout: "", stderr: "" });
  });

  return {
    waitForExit: () => exitPromise,
    state: () => state,
  };
}

function handleSearchKey(state: BrowserState, key: KeyEvent): void {
  if (key.name === "escape") {
    state.searchMode = false;
    return;
  }
  if (key.name === "backspace") {
    state.query = state.query.slice(0, -1);
    state.selectedIndex = 0;
    return;
  }
  if (key.name === "return") {
    state.searchMode = false;
    return;
  }
  const text = key.sequence.length === 1 ? key.sequence : key.raw;
  if (text.length === 1 && text >= " " && text !== "\x7f") {
    state.query += text;
    state.selectedIndex = 0;
  }
}

export function renderBrowserFrame(input: SessionBrowserInput | BrowserState): string {
  const state: BrowserState =
    "query" in input
      ? input
      : {
          ...input,
          query: "",
          searchMode: false,
          selectedIndex: 0,
          openedIdentity: null,
        };
  const rows = filteredRows(state);
  clampSelection(state);
  const selected = rows[state.selectedIndex];
  const renderedRows =
    rows.length === 0
      ? ["No sessions found"]
      : rows
          .slice(0, MAX_VISIBLE_ROWS)
          .map((row, index) => renderRow(row, index === state.selectedIndex));
  const preview =
    selected === undefined ? emptyPreview() : rowPreview(selected, state.openedIdentity);
  const warnings =
    state.warnings.length === 0 ? "" : `Warnings: ${state.warnings.slice(0, 2).join(" | ")}\n`;

  return [
    "Agent Trail Browser",
    `Rows: ${rows.length}/${state.rows.length}  Search: ${state.query}${state.searchMode ? " _" : ""}`,
    "",
    "Sessions",
    ...renderedRows,
    "",
    "Preview",
    ...preview,
    "",
    warnings.trimEnd(),
    "Keys: j/k or arrows move  / search  enter open placeholder  q quit",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function renderRow(row: SessionBrowserRow, selected: boolean): string {
  const marker = selected ? ">" : " ";
  return `${marker} ${row.state} ${row.agent ?? MISSING} ${row.cwd ?? MISSING} ${
    row.latest_at ?? MISSING
  } ${shortIdentity(row)}`;
}

function rowPreview(row: SessionBrowserRow, openedIdentity: string | null): string[] {
  const id = shortIdentity(row);
  return [
    openedIdentity === rowIdentity(row) ? `Open placeholder: ${id}` : "Selected row",
    `state: ${row.state}`,
    `agent: ${row.agent ?? MISSING}`,
    `cwd: ${row.cwd ?? MISSING}`,
    `time: ${row.latest_at ?? MISSING}`,
    `id: ${id}`,
    `source: ${row.source_path ?? row.registered_source_path ?? MISSING}`,
  ];
}

function emptyPreview(): string[] {
  return ["No row selected"];
}

function filteredRows(state: BrowserState): SessionBrowserRow[] {
  const query = state.query.trim().toLowerCase();
  if (query.length === 0) return state.rows;
  return state.rows.filter((row) => rowSearchText(row).toLowerCase().includes(query));
}

function rowSearchText(row: SessionBrowserRow): string {
  return Object.values(row)
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function clampSelection(state: BrowserState): void {
  const count = filteredRows(state).length;
  if (count === 0) {
    state.selectedIndex = 0;
    return;
  }
  state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, count - 1));
}

function shortIdentity(row: SessionBrowserRow): string {
  const id = row.source_id ?? row.content_hash ?? MISSING;
  return id.slice(0, 12);
}

function rowIdentity(row: SessionBrowserRow): string {
  return row.source_id ?? row.content_hash ?? "";
}
