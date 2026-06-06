import type { BrowserState, SessionBrowserInput } from "./session-browser-state.ts";
import {
  browserStateFromInput,
  defaultScope,
  sanitizeTerminalText,
} from "./session-browser-state.ts";

export type BrowserLayoutOptions = {
  width?: number;
  height?: number;
};

export type BrowserFrameLayout = {
  outerWidth: number;
  outerHeight: number;
  width: number;
  height: number;
  bodyRows: number;
  split: boolean;
  tableWidth: number;
  previewWidth: number;
  includeProjectColumn: boolean;
};

export type HeaderBackgroundRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type TableColumnKey = "serial" | "date" | "name" | "project" | "agent" | "trail";

export type TableColumnSpan = {
  key: TableColumnKey;
  start: number;
  end: number;
};

export const DEFAULT_WIDTH = 80;
export const DEFAULT_HEIGHT = 24;
export const MIN_SPLIT_WIDTH = 108;
export const FRAME_PADDING_X = 2;
export const FRAME_PADDING_Y = 1;
export const PANE_DIVIDER = "│";
export const PANE_GAP = 2;
export const CELL_PADDING_X = 1;
export const NAME_PREVIEW_LIMIT = 80;
export const FRAME_FIXED_LINES = 5;
export const PREVIEW_NAME_MAX_LINES = 3;

export function browserFrameLayout(
  state: Pick<BrowserState, "scope">,
  options: BrowserLayoutOptions,
): BrowserFrameLayout {
  const outerWidth = normalizedDimension(options.width, DEFAULT_WIDTH);
  const outerHeight = normalizedDimension(options.height, DEFAULT_HEIGHT);
  const width = Math.max(1, outerWidth - FRAME_PADDING_X * 2);
  const height = Math.max(1, outerHeight - FRAME_PADDING_Y * 2);
  const bodyRows = Math.max(0, height - FRAME_FIXED_LINES);
  const split = width >= MIN_SPLIT_WIDTH;
  const paneGap = split ? PANE_GAP : 0;
  const paneChrome = split ? 4 + paneGap : 2;
  const middleWidth = Math.max(1, width - paneChrome);
  const tableWidth = split ? Math.max(1, Math.floor((middleWidth * 2) / 3)) : middleWidth;
  return {
    outerWidth,
    outerHeight,
    width,
    height,
    bodyRows,
    split,
    tableWidth,
    previewWidth: split ? Math.max(1, middleWidth - tableWidth) : 0,
    includeProjectColumn: state.scope.mode === "all",
  };
}

export function headerBackgroundRects(options: BrowserLayoutOptions): {
  table: HeaderBackgroundRect | null;
  preview: HeaderBackgroundRect | null;
} {
  const layout = browserFrameLayout({ scope: defaultScope() }, options);
  const headerTop = FRAME_PADDING_Y + 2;
  if (headerTop >= layout.outerHeight || layout.height <= 0) {
    return { table: null, preview: null };
  }
  return {
    table: {
      left: FRAME_PADDING_X + 1,
      top: headerTop,
      width: layout.tableWidth,
      height: 1,
    },
    preview: layout.split
      ? {
          left: FRAME_PADDING_X + layout.tableWidth + PANE_GAP + 3,
          top: headerTop,
          width: layout.previewWidth,
          height: 1,
        }
      : null,
  };
}

export function tableStyleLayout(
  input: SessionBrowserInput | BrowserState,
  options: BrowserLayoutOptions,
): {
  headerLineIndex: number;
  bodyStartLineIndex: number;
  bodyEndLineIndex: number;
  spans: TableColumnSpan[];
} {
  const layout = browserFrameLayout(browserStateFromInput(input), options);
  return {
    headerLineIndex: FRAME_PADDING_Y + 2,
    bodyStartLineIndex: FRAME_PADDING_Y + 3,
    bodyEndLineIndex: FRAME_PADDING_Y + 3 + layout.bodyRows,
    spans: tableColumnSpans(tableColumns(layout.tableWidth, layout.includeProjectColumn)),
  };
}

export function renderBoxedPaneLine(
  table: string,
  preview: string,
  layout: BrowserFrameLayout,
): string {
  if (!layout.split) return `│${fitText(table, layout.tableWidth)}│`;
  const previewCell = isRuleText(preview)
    ? fitText(preview, layout.previewWidth)
    : fitCell(preview, layout.previewWidth);
  return `│${fitText(table, layout.tableWidth)}│${" ".repeat(PANE_GAP)}│${previewCell}│`;
}

export function renderPaneRule(position: "top" | "bottom", layout: BrowserFrameLayout): string {
  const chars = position === "top" ? { left: "┌", right: "┐" } : { left: "└", right: "┘" };
  const table = rule(layout.tableWidth);
  if (!layout.split) return `${chars.left}${table}${chars.right}`;
  return `${chars.left}${table}${chars.right}${" ".repeat(PANE_GAP)}${chars.left}${rule(
    layout.previewWidth,
  )}${chars.right}`;
}

export function tableColumns(
  width: number,
  includeProject = false,
): {
  serial: number;
  date: number;
  name: number;
  project?: number;
  agent: number;
  trail: number;
} {
  const serial = 5;
  const date = 18;
  const trail = 7;
  const project = includeProject ? 16 : 0;
  const flexible = Math.max(2, width - serial - date - project - trail);
  const agent = flexible >= 40 ? 14 : 8;
  const name = Math.max(1, flexible - agent);
  return includeProject
    ? { serial, date, name, project, agent, trail }
    : { serial, date, name, agent, trail };
}

export function tableColumnSpans(columns: ReturnType<typeof tableColumns>): TableColumnSpan[] {
  const spans: TableColumnSpan[] = [];
  let start = 0;
  const push = (key: TableColumnKey, width: number) => {
    spans.push({ key, start, end: start + width });
    start += width;
  };
  push("serial", columns.serial);
  push("date", columns.date);
  push("name", columns.name);
  if (columns.project !== undefined) push("project", columns.project);
  push("agent", columns.agent);
  push("trail", columns.trail);
  return spans;
}

export function padFrame(lines: string[], outerWidth: number): string {
  const horizontalPadding = " ".repeat(FRAME_PADDING_X);
  const blankLine = " ".repeat(outerWidth);
  const paddedLines = lines.map((line) =>
    fitText(`${horizontalPadding}${line}`, Math.max(1, outerWidth)),
  );
  const verticalPadding = Array.from({ length: FRAME_PADDING_Y }, () => blankLine);
  return [...verticalPadding, ...paddedLines, ...verticalPadding].join("\n");
}

export function fitText(value: string, width: number): string {
  return truncateText(sanitizeTerminalText(value), width).padEnd(width, " ");
}

export function fitCell(value: string, width: number): string {
  if (width <= CELL_PADDING_X * 2) return fitText(value, width);
  return ` ${fitText(value, width - CELL_PADDING_X * 2)} `;
}

export function wrapText(value: string, firstWidth: number, nextWidth = firstWidth): string[] {
  const clean = sanitizeTerminalText(value);
  const lines: string[] = [];
  let remaining = clean.trim();
  let width = Math.max(1, firstWidth);
  const continuationWidth = Math.max(1, nextWidth);
  while (remaining.length > width) {
    const slice = remaining.slice(0, width + 1);
    const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("/"));
    const end = breakAt > 0 ? breakAt : width;
    lines.push(remaining.slice(0, end).trimEnd());
    remaining = remaining.slice(end).trimStart();
    width = continuationWidth;
  }
  lines.push(remaining);
  return lines;
}

export function alignBetween(left: string, right: string, width: number): string {
  const safeLeft = sanitizeTerminalText(left);
  const safeRight = sanitizeTerminalText(right);
  if (safeLeft.length + safeRight.length + 1 <= width) {
    return `${safeLeft}${" ".repeat(width - safeLeft.length - safeRight.length)}${safeRight}`;
  }
  if (safeRight.length + 1 < width) {
    return `${fitText(safeLeft, width - safeRight.length - 1)} ${safeRight}`;
  }
  return fitText(safeRight, width);
}

export function tablePaneTextBounds(line: string): { start: number; end: number } | null {
  const leftBorder = line.indexOf(PANE_DIVIDER);
  if (leftBorder === -1) return null;
  const previewBounds = previewPaneBounds(line);
  const tableRight =
    previewBounds === null
      ? line.trimEnd().length - PANE_DIVIDER.length
      : line.lastIndexOf(PANE_DIVIDER, previewBounds.start - PANE_GAP - 1);
  if (tableRight <= leftBorder) return null;
  return { start: leftBorder + PANE_DIVIDER.length, end: tableRight };
}

export function previewPaneBounds(line: string): { start: number; end: number } | null {
  const contentEnd = line.trimEnd().length;
  const rightBorder =
    contentEnd > 0 && line[contentEnd - PANE_DIVIDER.length] === PANE_DIVIDER
      ? contentEnd - PANE_DIVIDER.length
      : -1;
  if (rightBorder === -1) return null;
  const paneIndex = line.lastIndexOf(PANE_DIVIDER, rightBorder - 1);
  if (paneIndex === -1) return null;
  const leftBorder = line.indexOf(PANE_DIVIDER);
  if (paneIndex === leftBorder) return null;
  return { start: paneIndex + PANE_DIVIDER.length, end: rightBorder };
}

function normalizedDimension(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.floor(value));
}

function rule(width: number): string {
  return "─".repeat(Math.max(0, width));
}

function truncateText(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

function isRuleText(value: string): boolean {
  return value.length > 0 && [...value].every((char) => char === "─");
}
