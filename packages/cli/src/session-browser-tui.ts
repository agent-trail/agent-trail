import {
  BoxRenderable,
  type CliRenderer,
  createCliRenderer,
  type KeyEvent,
  TextRenderable,
} from "@opentui/core";
import type { CliResult } from "./command.ts";
import type {
  BrowserState,
  HeaderBackgroundRect,
  SessionBrowserInput,
} from "./session-browser-frame.ts";
import {
  browserStateFromInput,
  COLOR_TABLE_HEADER_BG,
  COLOR_TEXT,
  clampSelection,
  defaultScope,
  exitResult,
  filteredRows,
  headerBackgroundRects,
  nextTrailFilter,
  renderStyledBrowserFrame,
  rowIdentity,
} from "./session-browser-frame.ts";
import type { TerminalIo } from "./terminal.ts";

export type { SessionBrowserInput, SessionBrowserRow } from "./session-browser-frame.ts";
export { renderBrowserFrame, sanitizeTerminalText } from "./session-browser-frame.ts";

export type SessionBrowserTerminal = TerminalIo;

export type MountedSessionBrowser = {
  waitForExit: () => Promise<CliResult>;
  state: () => BrowserState;
};

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
    const exit = app.waitForExit();
    const first = await Promise.race([renderer.idle().then(() => null), exit]);
    if (first !== null) return first;
    return await exit;
  } catch (error) {
    if (!renderer.isDestroyed) renderer.destroy();
    throw error;
  }
}

export function mountSessionBrowser(
  renderer: CliRenderer,
  input: SessionBrowserInput,
): MountedSessionBrowser {
  const state = browserStateFromInput(input);
  let resolveExit: (result: CliResult) => void;
  const exitPromise = new Promise<CliResult>((resolve) => {
    resolveExit = resolve;
  });
  const root = new TextRenderable(renderer, {
    content: renderStyledBrowserFrame(state, renderer),
    fg: COLOR_TEXT,
    zIndex: 1,
    width: "100%",
    height: "100%",
    overflow: "hidden",
    truncate: true,
    wrapMode: "none",
  });
  const tableHeaderBackground = new BoxRenderable(renderer, {
    backgroundColor: COLOR_TABLE_HEADER_BG,
    border: false,
    height: 0,
    left: 0,
    position: "absolute",
    shouldFill: true,
    top: 0,
    width: 0,
    zIndex: 0,
  });
  const previewHeaderBackground = new BoxRenderable(renderer, {
    backgroundColor: COLOR_TABLE_HEADER_BG,
    border: false,
    height: 0,
    left: 0,
    position: "absolute",
    shouldFill: true,
    top: 0,
    width: 0,
    zIndex: 0,
  });
  const syncHeaderBackgrounds = () => {
    const rects = headerBackgroundRects(renderer);
    applyHeaderBackgroundRect(tableHeaderBackground, rects.table);
    applyHeaderBackgroundRect(previewHeaderBackground, rects.preview);
  };

  const update = () => {
    clampSelection(state);
    root.content = renderStyledBrowserFrame(state, renderer);
    syncHeaderBackgrounds();
    renderer.requestRender();
  };
  const onResize = () => update();

  const quit = () => {
    renderer.keyInput.off("keypress", onKey);
    renderer.off("resize", onResize);
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
    if (key.name === "a" || key.sequence === "a") {
      toggleScope(state, update).catch(() => {});
      return;
    }
    if (key.name === "t" || key.sequence === "t") {
      state.trailFilter = nextTrailFilter(state.trailFilter);
      state.selectedIndex = 0;
      state.openedIdentity = null;
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

  syncHeaderBackgrounds();
  renderer.root.add(tableHeaderBackground);
  renderer.root.add(previewHeaderBackground);
  renderer.root.add(root);
  renderer.keyInput.on("keypress", onKey);
  renderer.on("resize", onResize);
  renderer.once("destroy", () => {
    renderer.keyInput.off("keypress", onKey);
    renderer.off("resize", onResize);
    resolveExit(exitResult(state));
  });

  return {
    waitForExit: () => exitPromise,
    state: () => state,
  };
}

function applyHeaderBackgroundRect(box: BoxRenderable, rect: HeaderBackgroundRect | null): void {
  box.visible = rect !== null;
  if (rect === null) {
    box.width = 0;
    box.height = 0;
    return;
  }
  box.left = rect.left;
  box.top = rect.top;
  box.width = rect.width;
  box.height = rect.height;
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

async function toggleScope(state: BrowserState, update: () => void): Promise<void> {
  if (state.onToggleScope === undefined || state.loading) return;
  const nextScope = state.scope.mode === "cwd" ? "all" : "cwd";
  state.loading = true;
  update();
  try {
    const input = await state.onToggleScope(nextScope);
    state.rows = input.rows;
    state.warnings = input.warnings;
    state.scope = input.scope ?? defaultScope();
    state.onToggleScope = input.onToggleScope ?? state.onToggleScope;
    state.query = "";
    state.searchMode = false;
    state.trailFilter = "all";
    state.selectedIndex = 0;
    state.openedIdentity = null;
  } finally {
    state.loading = false;
    update();
  }
}
