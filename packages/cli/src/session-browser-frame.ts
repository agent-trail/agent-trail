import type { StyledText } from "@opentui/core";
import {
  alignBetween,
  type BrowserLayoutOptions,
  browserFrameLayout,
  CELL_PADDING_X,
  fitCell,
  fitText,
  NAME_PREVIEW_LIMIT,
  PREVIEW_NAME_MAX_LINES,
  padFrame,
  renderBoxedPaneLine,
  renderPaneRule,
  tableColumns,
  wrapText,
} from "./session-browser-layout.ts";
import {
  type BrowserState,
  browserStateFromInput,
  clampSelection,
  filteredRows,
  formatLocalDate,
  formatSerial,
  renderValue,
  rowDisplayName,
  rowIdentity,
  rowPreviewName,
  rowProjectName,
  type SessionBrowserInput,
  type SessionBrowserRow,
  sanitizeTerminalText,
  scopeLabel,
  searchLabel,
  selectedWindowStart,
  shortIdentity,
  trailAvailability,
  trailFilterLabel,
} from "./session-browser-state.ts";
import { styleBrowserFrame } from "./session-browser-style.ts";

export type { BrowserLayoutOptions, HeaderBackgroundRect } from "./session-browser-layout.ts";
export { headerBackgroundRects } from "./session-browser-layout.ts";
export type {
  BrowserScope,
  BrowserScopeMode,
  BrowserState,
  SessionBrowserInput,
  SessionBrowserRow,
  TrailFilter,
} from "./session-browser-state.ts";
export {
  browserStateFromInput,
  clampSelection,
  defaultScope,
  exitResult,
  filteredRows,
  nextTrailFilter,
  rowIdentity,
  sanitizeTerminalText,
} from "./session-browser-state.ts";
export { COLOR_TABLE_HEADER_BG, COLOR_TEXT } from "./session-browser-style.ts";

type TableCells = {
  serial: string;
  date: string;
  name: string;
  project?: string;
  agent: string;
  trail: string;
};

export function renderBrowserFrame(
  input: SessionBrowserInput | BrowserState,
  options: BrowserLayoutOptions = {},
): string {
  const state = browserStateFromInput(input);
  const rows = filteredRows(state);
  clampSelection(state);
  const selected = rows[state.selectedIndex];
  const layout = browserFrameLayout(state, options);
  const visibleRowCapacity = rows.length === 0 ? layout.bodyRows : Math.max(1, layout.bodyRows);
  const visibleStart = selectedWindowStart(state.selectedIndex, rows.length, visibleRowCapacity);
  const renderedRows =
    rows.length === 0
      ? [fitText("  No sessions found", layout.tableWidth)]
      : rows
          .slice(visibleStart, visibleStart + visibleRowCapacity)
          .map((row, index) =>
            renderTableRow(
              row,
              visibleStart + index + 1,
              layout.tableWidth,
              layout.includeProjectColumn,
            ),
          );
  const tableLines = renderTableBodyLines(
    renderedRows,
    layout.tableWidth,
    layout.bodyRows,
    layout.includeProjectColumn,
  );
  const previewContentWidth = layout.split
    ? Math.max(1, layout.previewWidth - CELL_PADDING_X * 2)
    : NAME_PREVIEW_LIMIT;
  const preview =
    selected === undefined
      ? emptyPreview()
      : rowPreview(selected, state.openedIdentity, state.actionMessage, previewContentWidth);
  const body = Array.from({ length: layout.bodyRows }, (_value, index) =>
    layout.split
      ? renderBoxedPaneLine(
          tableLines[index] ?? fitText("", layout.tableWidth),
          preview[index] ?? "",
          layout,
        )
      : renderBoxedPaneLine(tableLines[index] ?? fitText("", layout.tableWidth), "", layout),
  );

  return padFrame(
    [
      renderHeader(state, layout.width),
      renderPaneRule("top", layout),
      renderBoxedPaneLine(
        renderTableHeader(layout.tableWidth, layout.includeProjectColumn),
        "PREVIEW",
        layout,
      ),
      ...body,
      renderPaneRule("bottom", layout),
      renderFooter(state, rows.length, layout.width),
    ],
    layout.outerWidth,
  );
}

export function renderStyledBrowserFrame(
  input: SessionBrowserInput | BrowserState,
  options: BrowserLayoutOptions = {},
): StyledText {
  return styleBrowserFrame(renderBrowserFrame(input, options), input, options);
}

function renderTableBodyLines(
  rows: string[],
  tableWidth: number,
  bodyRows: number,
  includeProject: boolean,
): string[] {
  const lines = rows.slice(0, bodyRows);
  while (lines.length < bodyRows) {
    lines.push(renderEmptyTableRow(tableWidth, includeProject));
  }
  return lines;
}

function renderTableHeader(width: number, includeProject: boolean): string {
  const columns = tableColumns(width, includeProject);
  return renderTableCells(
    {
      serial: "#",
      date: "DATE",
      name: "TITLE",
      project: includeProject ? "PROJECT" : undefined,
      agent: "AGENT",
      trail: "TRAIL",
    },
    columns,
  );
}

function renderTableRow(
  row: SessionBrowserRow,
  serial: number,
  width: number,
  includeProject: boolean,
): string {
  const columns = tableColumns(width, includeProject);
  return renderTableCells(
    {
      serial: formatSerial(serial),
      date: formatLocalDate(row.latest_at),
      name: rowDisplayName(row),
      project: includeProject ? rowProjectName(row) : undefined,
      agent: renderValue(row.agent),
      trail: trailAvailability(row),
    },
    columns,
  );
}

function renderEmptyTableRow(width: number, includeProject: boolean): string {
  const columns = tableColumns(width, includeProject);
  return renderTableCells(
    {
      serial: "",
      date: "",
      name: "",
      project: includeProject ? "" : undefined,
      agent: "",
      trail: "",
    },
    columns,
  );
}

function renderTableCells(cells: TableCells, columns: ReturnType<typeof tableColumns>): string {
  const project =
    columns.project === undefined ? "" : fitCell(cells.project ?? "", columns.project);
  return `${fitCell(cells.serial, columns.serial)}${fitCell(cells.date, columns.date)}${fitCell(
    cells.name,
    columns.name,
  )}${project}${fitCell(cells.agent, columns.agent)}${fitCell(cells.trail, columns.trail)}`;
}

function rowPreview(
  row: SessionBrowserRow,
  openedIdentity: string | null,
  actionMessage: string | null,
  contentWidth: number,
): string[] {
  const id = shortIdentity(row);
  return airyPreview([
    ...(actionMessage === null ? [] : previewFieldLines("STATUS", actionMessage, contentWidth)),
    openedIdentity === rowIdentity(row) ? `Open placeholder: ${id}` : "Selected row",
    ...previewFieldLines("NAME", rowPreviewName(row), contentWidth, PREVIEW_NAME_MAX_LINES),
    previewFieldLine("AGENT", renderValue(row.agent)),
    previewFieldLine("DATE", formatLocalDate(row.latest_at)),
    previewFieldLine("TRAIL", trailAvailability(row)),
    previewFieldLine("STATE", row.state),
    ...previewFieldLines("CWD", renderValue(row.cwd), contentWidth),
    ...previewFieldLines(
      "SOURCE",
      renderValue(row.source_path ?? row.registered_source_path),
      contentWidth,
    ),
    previewFieldLine("ID", id),
  ]);
}

function emptyPreview(): string[] {
  return ["No row selected"];
}

function previewFieldLine(label: string, value: string): string {
  return `${label} ${value}`;
}

function previewFieldLines(
  label: string,
  value: string,
  width: number,
  maxLines?: number,
): string[] {
  const prefix = `${label} `;
  const firstWidth = Math.max(1, width - prefix.length);
  const continuationPrefix = " ".repeat(prefix.length);
  const wrapped = wrapText(value, firstWidth, width - continuationPrefix.length);
  const visible = maxLines === undefined ? wrapped : wrapped.slice(0, Math.max(1, maxLines));
  const [first = ""] = visible;
  return [`${prefix}${first}`, ...visible.slice(1).map((line) => `${continuationPrefix}${line}`)];
}

function airyPreview(lines: string[]): string[] {
  return lines.flatMap((line) => [line, ""]);
}

function renderHeader(state: BrowserState, width: number): string {
  const loading = state.loading ? "  LOADING" : "";
  return alignBetween(
    "AGENT TRAIL BROWSER",
    `PROJECT ${scopeLabel(state.scope)}  TRAIL ${trailFilterLabel(
      state.trailFilter,
    )}${loading}  SEARCH ${searchLabel(state)}`,
    width,
  );
}

function renderFooter(state: BrowserState, filteredCount: number, width: number): string {
  const warnings = state.warnings.slice(0, 2).map(sanitizeTerminalText);
  const rowCounts = `ROWS ${state.rows.length}  FILTERED ${filteredCount}`;
  const status =
    state.actionMessage === null ? "" : `  STATUS ${sanitizeTerminalText(state.actionMessage)}`;
  const left =
    warnings.length === 0
      ? `${rowCounts}${status}`
      : `${rowCounts}  WARN ${warnings.join(" | ")}${status}`;
  return alignBetween(
    left,
    "keys: j/k move  enter open  s/e/y  a all  t trail  / search  q quit",
    width,
  );
}
