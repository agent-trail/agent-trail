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
  clampSelection,
  defaultScope,
  exitResult,
  filteredRows,
  headerBackgroundRects,
  nextTrailFilter,
  renderStyledBrowserFrame,
  rowIdentity,
  sanitizeTerminalText,
} from "./session-browser-frame.ts";
import {
  COLOR_BORDER,
  COLOR_CONFIRM_DIALOG_BG,
  COLOR_STATUS_DIALOG_BG,
  COLOR_TABLE_HEADER_BG,
  COLOR_TEXT,
} from "./session-browser-style.ts";
import type { TerminalIo } from "./terminal.ts";

export type { SessionBrowserInput, SessionBrowserRow } from "./session-browser-frame.ts";
export { renderBrowserFrame, sanitizeTerminalText } from "./session-browser-frame.ts";

export type SessionBrowserTerminal = TerminalIo;

export type MountedSessionBrowser = {
  waitForExit: () => Promise<CliResult>;
  state: () => BrowserState;
};

type ConfirmDialogState = {
  message: string;
  resolve: (confirmed: boolean) => void;
};

type StatusDialogState =
  | {
      kind: "uploading";
      message: string;
    }
  | {
      kind: "created";
      message: string;
      url: string;
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
    const detachTestInput = attachNonRawInputQuitFallback(terminal.stdin, renderer);
    const exit = app.waitForExit();
    const first = await Promise.race([renderer.idle().then(() => null), exit]);
    try {
      if (first !== null) return first;
      return await exit;
    } finally {
      detachTestInput();
    }
  } catch (error) {
    if (!renderer.isDestroyed) renderer.destroy();
    throw error;
  }
}

function attachNonRawInputQuitFallback(
  stdin: NodeJS.ReadStream | undefined,
  renderer: CliRenderer,
): () => void {
  if (stdin === undefined || typeof stdin.setRawMode === "function") return () => {};
  const onData = (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if ((text.includes("q") || text.includes("\u0003")) && !renderer.isDestroyed) {
      renderer.destroy();
    }
  };
  stdin.on("data", onData);
  return () => stdin.off("data", onData);
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
  const confirmDialog = new BoxRenderable(renderer, {
    backgroundColor: COLOR_CONFIRM_DIALOG_BG,
    border: true,
    borderColor: COLOR_BORDER,
    borderStyle: "single",
    height: 0,
    left: 0,
    position: "absolute",
    shouldFill: true,
    title: "Confirm share",
    titleAlignment: "center",
    top: 0,
    visible: false,
    width: 0,
    zIndex: 20,
  });
  const confirmDialogText = new TextRenderable(renderer, {
    bg: COLOR_CONFIRM_DIALOG_BG,
    content: "",
    fg: COLOR_TEXT,
    height: 0,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    selectable: false,
    top: 0,
    truncate: true,
    visible: false,
    width: 0,
    wrapMode: "none",
    zIndex: 21,
  });
  const statusDialog = new BoxRenderable(renderer, {
    backgroundColor: COLOR_STATUS_DIALOG_BG,
    border: true,
    borderColor: COLOR_BORDER,
    borderStyle: "single",
    height: 0,
    left: 0,
    position: "absolute",
    shouldFill: true,
    title: "Share created",
    titleAlignment: "center",
    top: 0,
    visible: false,
    width: 0,
    zIndex: 22,
  });
  const statusDialogText = new TextRenderable(renderer, {
    bg: COLOR_STATUS_DIALOG_BG,
    content: "",
    fg: COLOR_TEXT,
    height: 0,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    selectable: false,
    top: 0,
    truncate: true,
    visible: false,
    width: 0,
    wrapMode: "none",
    zIndex: 23,
  });
  let activeConfirmDialog: ConfirmDialogState | null = null;
  let activeStatusDialog: StatusDialogState | null = null;
  const syncHeaderBackgrounds = () => {
    const rects = headerBackgroundRects(renderer);
    applyHeaderBackgroundRect(tableHeaderBackground, rects.table);
    applyHeaderBackgroundRect(previewHeaderBackground, rects.preview);
  };
  const syncConfirmDialog = () => {
    applyConfirmDialog(confirmDialog, confirmDialogText, activeConfirmDialog, renderer);
  };
  const syncStatusDialog = () => {
    applyStatusDialog(statusDialog, statusDialogText, activeStatusDialog, renderer);
  };

  const update = () => {
    clampSelection(state);
    root.content = renderStyledBrowserFrame(state, renderer);
    syncHeaderBackgrounds();
    syncConfirmDialog();
    syncStatusDialog();
    renderer.requestRender();
  };
  const onResize = () => update();
  const closeConfirmDialog = (confirmed: boolean) => {
    const dialog = activeConfirmDialog;
    activeConfirmDialog = null;
    syncConfirmDialog();
    dialog?.resolve(confirmed);
    update();
  };
  const showConfirmDialog = (message: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (activeConfirmDialog !== null) closeConfirmDialog(false);
      activeStatusDialog = null;
      activeConfirmDialog = { message, resolve };
      update();
    });
  const showUploadDialog = (message: string) => {
    activeStatusDialog = { kind: "uploading", message };
    update();
  };
  const showStatusDialog = (message: string, url: string) => {
    activeStatusDialog = { kind: "created", message, url };
    update();
  };
  const closeStatusDialog = () => {
    activeStatusDialog = null;
    update();
  };

  const quit = () => {
    if (activeConfirmDialog !== null) closeConfirmDialog(false);
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
    if (activeConfirmDialog !== null) {
      handleConfirmDialogKey(key, closeConfirmDialog);
      return;
    }
    if (activeStatusDialog !== null) {
      handleStatusDialogKey(activeStatusDialog, key, closeStatusDialog, () => {
        closeStatusDialog();
        void copyLatestUrlSafely(state, update);
      });
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
      void toggleScopeSafely(state, update);
      return;
    }
    if (key.name === "t" || key.sequence === "t") {
      state.trailFilter = nextTrailFilter(state.trailFilter);
      state.selectedIndex = 0;
      state.openedIdentity = null;
      update();
      return;
    }
    if (key.name === "s" || key.sequence === "s") {
      void runRowActionSafely(
        state,
        "share",
        update,
        showConfirmDialog,
        showUploadDialog,
        showStatusDialog,
        closeStatusDialog,
      );
      return;
    }
    if (key.name === "e" || key.sequence === "e") {
      void runRowActionSafely(state, "export", update);
      return;
    }
    if (key.name === "y" || key.sequence === "y") {
      void copyLatestUrlSafely(state, update);
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
  renderer.root.add(confirmDialog);
  renderer.root.add(confirmDialogText);
  renderer.root.add(statusDialog);
  renderer.root.add(statusDialogText);
  renderer.keyInput.on("keypress", onKey);
  renderer.on("resize", onResize);
  renderer.once("destroy", () => {
    if (activeConfirmDialog !== null) {
      activeConfirmDialog.resolve(false);
      activeConfirmDialog = null;
    }
    activeStatusDialog = null;
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

function applyConfirmDialog(
  box: BoxRenderable,
  text: TextRenderable,
  dialog: ConfirmDialogState | null,
  options: { width?: number; height?: number },
): void {
  if (dialog === null) {
    box.visible = false;
    text.visible = false;
    box.width = 0;
    box.height = 0;
    text.width = 0;
    text.height = 0;
    return;
  }
  const screenWidth = Math.max(1, options.width ?? 80);
  const screenHeight = Math.max(1, options.height ?? 24);
  const width = Math.min(Math.max(34, screenWidth - 8), 72);
  const height = Math.min(9, Math.max(7, screenHeight - 4));
  const left = Math.max(0, Math.floor((screenWidth - width) / 2));
  const top = Math.max(0, Math.floor((screenHeight - height) / 2));
  const textWidth = Math.max(1, width - 4);
  const textHeight = Math.max(1, height - 2);

  box.visible = true;
  box.title = "Confirm share";
  box.left = left;
  box.top = top;
  box.width = width;
  box.height = height;

  text.visible = true;
  text.left = left + 2;
  text.top = top + 1;
  text.width = textWidth;
  text.height = textHeight;
  text.content = renderConfirmDialogText(dialog.message, textWidth, textHeight);
}

function applyStatusDialog(
  box: BoxRenderable,
  text: TextRenderable,
  dialog: StatusDialogState | null,
  options: { width?: number; height?: number },
): void {
  if (dialog === null) {
    box.visible = false;
    text.visible = false;
    box.width = 0;
    box.height = 0;
    text.width = 0;
    text.height = 0;
    return;
  }
  const screenWidth = Math.max(1, options.width ?? 80);
  const screenHeight = Math.max(1, options.height ?? 24);
  const width = Math.min(Math.max(40, screenWidth - 8), 76);
  const height = Math.min(10, Math.max(8, screenHeight - 4));
  const left = Math.max(0, Math.floor((screenWidth - width) / 2));
  const top = Math.max(0, Math.floor((screenHeight - height) / 2));
  const textWidth = Math.max(1, width - 4);
  const textHeight = Math.max(1, height - 2);

  box.visible = true;
  box.title = dialog.kind === "uploading" ? "Uploading share" : "Share created";
  box.left = left;
  box.top = top;
  box.width = width;
  box.height = height;

  text.visible = true;
  text.left = left + 2;
  text.top = top + 1;
  text.width = textWidth;
  text.height = textHeight;
  text.content = renderStatusDialogText(dialog, textWidth, textHeight);
}

function renderConfirmDialogText(message: string, width: number, height: number): string {
  const lines = [
    ...wrapDialogLine(sanitizeTerminalText(message), width),
    "",
    "Y/Enter share",
    "N/Esc cancel",
  ];
  return lines
    .slice(0, height)
    .map((line) => line.padEnd(width, " "))
    .join("\n");
}

function renderStatusDialogText(dialog: StatusDialogState, width: number, height: number): string {
  const lines =
    dialog.kind === "uploading"
      ? [...wrapDialogLine(sanitizeTerminalText(dialog.message), width)]
      : [
          ...wrapDialogLine(sanitizeTerminalText(dialog.message), width),
          "",
          ...wrapDialogLine(sanitizeTerminalText(dialog.url), width),
          "",
          "Y copy URL",
          "Enter/Esc close",
        ];
  return lines
    .slice(0, height)
    .map((line) => line.padEnd(width, " "))
    .join("\n");
}

function wrapDialogLine(value: string, width: number): string[] {
  const words = value
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length === 0) {
      line = word.slice(0, width);
      continue;
    }
    if (line.length + 1 + word.length <= width) {
      line = `${line} ${word}`;
      continue;
    }
    lines.push(line);
    line = word.slice(0, width);
  }
  lines.push(line);
  return lines;
}

function handleConfirmDialogKey(
  key: KeyEvent,
  closeConfirmDialog: (confirmed: boolean) => void,
): void {
  if (key.name === "return" || key.name === "y" || key.sequence === "y") {
    closeConfirmDialog(true);
    return;
  }
  if (key.name === "escape" || key.name === "n" || key.sequence === "n") {
    closeConfirmDialog(false);
  }
}

function handleStatusDialogKey(
  dialog: StatusDialogState,
  key: KeyEvent,
  closeStatusDialog: () => void,
  copyUrl: () => void,
): void {
  if (dialog.kind === "uploading") return;
  if (key.name === "y" || key.sequence === "y") {
    copyUrl();
    return;
  }
  if (key.name === "return" || key.name === "escape") {
    closeStatusDialog();
  }
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

export async function toggleScopeSafely(state: BrowserState, update: () => void): Promise<void> {
  try {
    await toggleScope(state, update);
  } catch {}
}

async function runRowAction(
  state: BrowserState,
  kind: "share" | "export",
  update: () => void,
  confirm?: (message: string) => Promise<boolean>,
  showShareProgress?: (message: string) => void,
  showShareStatus?: (message: string, url: string) => void,
  closeShareStatus?: () => void,
): Promise<void> {
  if (state.loading) return;
  const row = filteredRows(state)[state.selectedIndex];
  if (row === undefined) {
    state.actionMessage = "No row selected";
    update();
    return;
  }
  const handler = kind === "share" ? state.onShare : state.onExport;
  if (handler === undefined) {
    state.actionMessage = `${kind === "share" ? "Share" : "Export"} unavailable`;
    update();
    return;
  }
  if (kind === "share") {
    const cachedUrl = cachedShareUrl(state, row);
    if (cachedUrl !== undefined) {
      state.latestShareUrl = cachedUrl;
      state.actionMessage = `Shared ${cachedUrl}`;
      showShareStatus?.("Already shared", cachedUrl);
      update();
      return;
    }
  }
  state.loading = true;
  state.actionMessage = null;
  update();
  try {
    const actionConfirm =
      confirm === undefined
        ? undefined
        : async (message: string): Promise<boolean> => {
            const confirmed = await confirm(message);
            if (kind === "share" && confirmed) showShareProgress?.("Uploading gist...");
            return confirmed;
          };
    const result = await handler(
      row,
      actionConfirm === undefined ? undefined : { confirm: actionConfirm },
    );
    if (result.rows !== undefined) state.rows = result.rows;
    if (result.url !== undefined) state.latestShareUrl = result.url;
    if (kind === "share" && result.url !== undefined) rememberShareUrl(state, row, result.url);
    state.actionMessage = result.message;
    if (kind === "share" && result.url !== undefined) {
      showShareStatus?.(result.message, result.url);
    } else if (kind === "share") {
      closeShareStatus?.();
    }
  } catch (error) {
    if (kind === "share") closeShareStatus?.();
    throw error;
  } finally {
    state.loading = false;
    update();
  }
}

function cachedShareUrl(
  state: BrowserState,
  row: BrowserState["rows"][number],
): string | undefined {
  for (const key of shareCacheKeys(row)) {
    const url = state.shareUrls[key];
    if (url !== undefined) return url;
  }
  return undefined;
}

function rememberShareUrl(
  state: BrowserState,
  row: BrowserState["rows"][number],
  url: string,
): void {
  for (const key of shareCacheKeys(row)) {
    state.shareUrls[key] = url;
  }
}

function shareCacheKeys(row: BrowserState["rows"][number]): string[] {
  const keys: string[] = [];
  if (row.content_hash !== null) keys.push(`hash:${row.content_hash}`);
  if (row.source_agent !== null && row.source_path !== null) {
    keys.push(`source-path:${row.source_agent}:${row.source_path}`);
  }
  if (row.source_agent !== null && row.source_id !== null) {
    keys.push(
      row.source_path === null
        ? `source:${row.source_agent}:${row.source_id}`
        : `source:${row.source_agent}:${row.source_id}:${row.source_path}`,
    );
  }
  return [...new Set(keys)];
}

export async function runRowActionSafely(
  state: BrowserState,
  kind: "share" | "export",
  update: () => void,
  confirm?: (message: string) => Promise<boolean>,
  showShareProgress?: (message: string) => void,
  showShareStatus?: (message: string, url: string) => void,
  closeShareStatus?: () => void,
): Promise<void> {
  try {
    await runRowAction(
      state,
      kind,
      update,
      confirm,
      showShareProgress,
      showShareStatus,
      closeShareStatus,
    );
  } catch (error) {
    state.loading = false;
    state.actionMessage = error instanceof Error ? error.message : String(error);
    update();
  }
}

async function copyLatestUrl(state: BrowserState, update: () => void): Promise<void> {
  if (state.latestShareUrl === null) {
    state.actionMessage = "No share URL to copy";
    update();
    return;
  }
  if (state.onCopyUrl === undefined) {
    state.actionMessage = "Copy unsupported";
    update();
    return;
  }
  state.loading = true;
  update();
  try {
    const result = await state.onCopyUrl(state.latestShareUrl);
    state.actionMessage = result.message;
  } finally {
    state.loading = false;
    update();
  }
}

export async function copyLatestUrlSafely(state: BrowserState, update: () => void): Promise<void> {
  try {
    await copyLatestUrl(state, update);
  } catch (error) {
    state.loading = false;
    state.actionMessage = error instanceof Error ? error.message : String(error);
    update();
  }
}
