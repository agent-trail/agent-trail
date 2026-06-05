import { type CliRenderer, createCliRenderer, type KeyEvent, TextRenderable } from "@opentui/core";
import type { CliResult } from "./command.ts";
import type { Row } from "./list-model.ts";
import type { TerminalIo } from "./terminal.ts";

export type SessionBrowserRow = Row;

export type SessionBrowserTerminal = TerminalIo;

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
// biome-ignore lint/complexity/useRegexLiterals: literal form trips noControlCharactersInRegex.
const ANSI_ESCAPE_RE = new RegExp(
  "\\u001B(?:\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)|[PX^_][^\\u001B]*(?:\\u001B\\\\)|\\[[0-?]*[ -/]*[@-~]|[@-Z\\\\-_])",
  "g",
);

export async function runSessionBrowserTui(
  input: SessionBrowserInput,
  terminal: SessionBrowserTerminal = {},
): Promise<CliResult> {
  const renderer = await createCliRenderer({
    stdin: terminal.stdin,
    stdout: terminal.stdout,
    width: terminal.width,
    height: terminal.height,
    screenMode: terminal.isTTY === true ? "alternate-screen" : "main-screen",
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
    resolveExit(exitResult(state));
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
    resolveExit(exitResult(state));
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
  const text = key.sequence.length === 1 ? key.sequence : (key.raw ?? "");
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
  const visibleStart = selectedWindowStart(state.selectedIndex, rows.length);
  const renderedRows =
    rows.length === 0
      ? ["No sessions found"]
      : rows
          .slice(visibleStart, visibleStart + MAX_VISIBLE_ROWS)
          .map((row, index) => renderRow(row, visibleStart + index === state.selectedIndex));
  const preview =
    selected === undefined ? emptyPreview() : rowPreview(selected, state.openedIdentity);
  const warnings =
    state.warnings.length === 0
      ? ""
      : `Warnings: ${state.warnings.slice(0, 2).map(sanitizeTerminalText).join(" | ")}\n`;

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
    warnings.length === 0 ? null : warnings.trimEnd(),
    "Keys: j/k or arrows move  / search  enter open placeholder  q quit",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function renderRow(row: SessionBrowserRow, selected: boolean): string {
  const marker = selected ? ">" : " ";
  return `${marker} ${row.state} ${renderValue(row.agent)} ${renderValue(row.cwd)} ${renderValue(
    row.latest_at,
  )} ${shortIdentity(row)}`;
}

function rowPreview(row: SessionBrowserRow, openedIdentity: string | null): string[] {
  const id = shortIdentity(row);
  return [
    openedIdentity === rowIdentity(row) ? `Open placeholder: ${id}` : "Selected row",
    `state: ${row.state}`,
    `agent: ${renderValue(row.agent)}`,
    `cwd: ${renderValue(row.cwd)}`,
    `time: ${renderValue(row.latest_at)}`,
    `id: ${id}`,
    `source: ${renderValue(row.source_path ?? row.registered_source_path)}`,
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

function selectedWindowStart(selectedIndex: number, rowCount: number): number {
  if (rowCount <= MAX_VISIBLE_ROWS) return 0;
  return Math.min(Math.max(0, selectedIndex - MAX_VISIBLE_ROWS + 1), rowCount - MAX_VISIBLE_ROWS);
}

function shortIdentity(row: SessionBrowserRow): string {
  const id = row.source_id ?? row.content_hash ?? MISSING;
  return sanitizeTerminalText(id).slice(0, 12);
}

function rowIdentity(row: SessionBrowserRow): string {
  return row.source_id ?? row.content_hash ?? "";
}

function renderValue(value: string | null): string {
  return value === null ? MISSING : sanitizeTerminalText(value);
}

export function sanitizeTerminalText(value: string): string {
  let sanitized = "";
  for (const char of value.replace(ANSI_ESCAPE_RE, "")) {
    const code = char.charCodeAt(0);
    sanitized += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : char;
  }
  return sanitized;
}

function exitResult(state: BrowserState): CliResult {
  const warnings = state.warnings.map(sanitizeTerminalText);
  return {
    exitCode: 0,
    stdout: "",
    stderr: warnings.length === 0 ? "" : `${warnings.join("\n")}\n`,
  };
}
