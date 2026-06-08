import { bold, StyledText, fg as styleFg } from "@opentui/core";
import {
  type BrowserLayoutOptions,
  browserFrameLayout,
  FRAME_PADDING_Y,
  PANE_DIVIDER,
  previewPaneBounds,
  type TableColumnSpan,
  tablePaneTextBounds,
  tableStyleLayout,
} from "./session-browser-layout.ts";
import {
  type BrowserState,
  browserStateFromInput,
  filteredRows,
  type SessionBrowserInput,
  selectedWindowStart,
} from "./session-browser-state.ts";

export const COLOR_TEXT = "#b8b8b8";
export const COLOR_PRIMARY = "#f0f0f0";
export const COLOR_BORDER = "#f0f0f0";
export const COLOR_HEADER = "#777777";
export const COLOR_MUTED = "#858585";
export const COLOR_PREVIEW_LABEL = "#e0e0e0";
export const COLOR_SELECTED_FG = "#ff9c9c";
export const COLOR_TABLE_HEADER_BG = "#171717";
export const COLOR_CONFIRM_DIALOG_BG = "#2a2118";
export const COLOR_STATUS_DIALOG_BG = "#18242a";

export function styleBrowserFrame(
  frame: string,
  input: SessionBrowserInput | BrowserState,
  options: BrowserLayoutOptions = {},
): StyledText {
  const lines = frame.split("\n");
  const selectedLineIndex = selectedFrameLineIndex(input, options);
  const tableLayout = tableStyleLayout(input, options);
  const chunks = lines.flatMap((line, index) => {
    const text = index === lines.length - 1 ? line : `${line}\n`;
    if (index === selectedLineIndex) {
      return styleSelectedLine(line, index !== lines.length - 1, tableLayout.spans);
    }
    const headerChunks = styleHeaderMetricLine(line, index !== lines.length - 1);
    if (headerChunks !== null) return headerChunks;
    if (index === 0 || index === lines.length - 1) {
      return [styleFg(COLOR_HEADER)(text)];
    }
    if (isPaneRuleFrameLine(line)) {
      return [styleFg(COLOR_BORDER)(text)];
    }
    if (index === tableLayout.headerLineIndex) {
      return styleTableHeaderLine(line, index !== lines.length - 1);
    }
    if (index >= tableLayout.bodyStartLineIndex && index < tableLayout.bodyEndLineIndex) {
      return styleTableDataLine(line, index !== lines.length - 1, tableLayout.spans, false);
    }
    const previewChunks = stylePreviewLabelLine(line, index !== lines.length - 1);
    if (previewChunks !== null) return previewChunks;
    return [styleFg(COLOR_TEXT)(text)];
  });
  return new StyledText(chunks);
}

function styleHeaderMetricLine(line: string, includeNewline: boolean) {
  const metricStart = line.indexOf("PROJECT ");
  if (metricStart === -1 || !line.includes("AGENT TRAIL BROWSER")) return null;
  const title = "AGENT TRAIL BROWSER";
  const titleStart = line.indexOf(title);
  if (titleStart !== -1 && titleStart < metricStart) {
    return [
      styleFg(COLOR_HEADER)(line.slice(0, titleStart)),
      bold(styleFg(COLOR_PREVIEW_LABEL)(title)),
      ...styleLabelOccurrences(
        line.slice(titleStart + title.length),
        ["PROJECT", "TRAIL", "SEARCH"],
        includeNewline,
        COLOR_HEADER,
        metricStart - titleStart - title.length,
      ),
    ];
  }
  return styleLabelOccurrences(
    line,
    ["PROJECT", "TRAIL", "SEARCH"],
    includeNewline,
    COLOR_HEADER,
    metricStart,
  );
}

function styleLabelOccurrences(
  line: string,
  labels: readonly string[],
  includeNewline: boolean,
  normalColor: string,
  startIndex = 0,
) {
  const chunks = [];
  let cursor = 0;
  let index = startIndex;
  const orderedLabels = [...labels].sort((a, b) => b.length - a.length);
  while (index < line.length) {
    const label = orderedLabels.find(
      (candidate) =>
        line.startsWith(candidate, index) &&
        isLabelBoundary(line[index - 1]) &&
        isLabelBoundary(line[index + candidate.length]),
    );
    if (label === undefined) {
      index += 1;
      continue;
    }
    chunks.push(styleFg(normalColor)(line.slice(cursor, index)));
    chunks.push(bold(styleFg(COLOR_PREVIEW_LABEL)(label)));
    cursor = index + label.length;
    index = cursor;
  }
  chunks.push(styleFg(normalColor)(`${line.slice(cursor)}${includeNewline ? "\n" : ""}`));
  return chunks;
}

function isLabelBoundary(value: string | undefined): boolean {
  return value === undefined || value === " " || value === PANE_DIVIDER;
}

function styleSelectedLine(
  line: string,
  includeNewline: boolean,
  spans: readonly TableColumnSpan[],
) {
  return styleTableDataLine(line, includeNewline, spans, true);
}

function styleTableHeaderLine(line: string, includeNewline: boolean) {
  const bounds = tablePaneTextBounds(line);
  if (bounds === null) return [styleFg(COLOR_TEXT)(`${line}${includeNewline ? "\n" : ""}`)];
  const previewBounds = previewPaneBounds(line);
  const suffixChunks =
    previewBounds === null
      ? [styleFg(COLOR_BORDER)(`${line.slice(bounds.end)}${includeNewline ? "\n" : ""}`)]
      : [
          styleFg(COLOR_BORDER)(line.slice(bounds.end, previewBounds.start)),
          bold(styleFg(COLOR_PRIMARY)(line.slice(previewBounds.start, previewBounds.end))),
          styleFg(COLOR_BORDER)(`${line.slice(previewBounds.end)}${includeNewline ? "\n" : ""}`),
        ];
  return [
    styleFg(COLOR_BORDER)(line.slice(0, bounds.start)),
    bold(styleFg(COLOR_PRIMARY)(line.slice(bounds.start, bounds.end))),
    ...suffixChunks,
  ];
}

function styleTableDataLine(
  line: string,
  includeNewline: boolean,
  spans: readonly TableColumnSpan[],
  selected: boolean,
) {
  const bounds = tablePaneTextBounds(line);
  if (bounds === null) return [styleFg(COLOR_TEXT)(`${line}${includeNewline ? "\n" : ""}`)];
  const suffixChunks = stylePreviewSuffix(line, includeNewline, bounds.end) ?? [
    styleFg(COLOR_BORDER)(`${line.slice(bounds.end)}${includeNewline ? "\n" : ""}`),
  ];
  return [
    styleFg(COLOR_BORDER)(line.slice(0, bounds.start)),
    ...styleTableColumns(line.slice(bounds.start, bounds.end), spans, selected),
    ...suffixChunks,
  ];
}

function isPaneRuleFrameLine(line: string): boolean {
  const text = line.trimStart();
  return text.startsWith("┌") || text.startsWith("├") || text.startsWith("└");
}

function styleTableColumns(text: string, spans: readonly TableColumnSpan[], selected: boolean) {
  const chunks = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      chunks.push(styleFg(COLOR_MUTED)(text.slice(cursor, span.start)));
    }
    const color =
      selected || span.key === "name" || span.key === "project" || span.key === "agent"
        ? COLOR_PRIMARY
        : COLOR_MUTED;
    chunks.push(
      ...styleTextRuns(text.slice(span.start, span.end), selected ? COLOR_SELECTED_FG : color),
    );
    cursor = span.end;
  }
  if (cursor < text.length) chunks.push(styleFg(COLOR_MUTED)(text.slice(cursor)));
  return chunks;
}

function styleTextRuns(text: string, color: string) {
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    const textStart = findNextNonSpace(text, cursor);
    if (textStart === -1) {
      chunks.push(styleFg(COLOR_MUTED)(text.slice(cursor)));
      break;
    }
    if (textStart > cursor) chunks.push(styleFg(COLOR_MUTED)(text.slice(cursor, textStart)));
    const textEnd = findNextSpace(text, textStart);
    chunks.push(styleFg(color)(text.slice(textStart, textEnd)));
    cursor = textEnd;
  }
  return chunks;
}

function selectedFrameLineIndex(
  input: SessionBrowserInput | BrowserState,
  options: BrowserLayoutOptions,
): number {
  const state = browserStateFromInput(input);
  const rows = filteredRows(state);
  if (rows.length === 0) return -1;
  const layout = browserFrameLayout(state, options);
  if (layout.bodyRows <= 0) return -1;
  const visibleRowCapacity = Math.max(1, layout.bodyRows);
  const clampedIndex = Math.max(0, Math.min(state.selectedIndex, rows.length - 1));
  const visibleStart = selectedWindowStart(clampedIndex, rows.length, visibleRowCapacity);
  if (clampedIndex < visibleStart || clampedIndex >= visibleStart + visibleRowCapacity) return -1;
  return FRAME_PADDING_Y + 3 + (clampedIndex - visibleStart);
}

const PREVIEW_LABELS = ["NAME", "AGENT", "DATE", "TRAIL", "STATE", "CWD", "SOURCE", "ID"];

function stylePreviewLabelLine(line: string, includeNewline: boolean, knownPreviewStart?: number) {
  const bounds = previewPaneBounds(line);
  if (bounds === null) return null;
  const previewStart = knownPreviewStart ?? bounds.start;
  const previewText = line.slice(previewStart, bounds.end);
  const label = PREVIEW_LABELS.find((candidate) => previewText.startsWith(` ${candidate} `));
  if (label === undefined) return null;
  return stylePreviewSuffix(line, includeNewline, 0);
}

function stylePreviewSuffix(line: string, includeNewline: boolean, prefixStart: number) {
  const bounds = previewPaneBounds(line);
  if (bounds === null) return null;
  const previewStart = bounds.start;
  const previewText = line.slice(previewStart, bounds.end);
  const label = PREVIEW_LABELS.find((candidate) => previewText.startsWith(` ${candidate} `));
  const suffix = includeNewline ? "\n" : "";
  if (label === undefined) {
    return [
      styleFg(COLOR_BORDER)(line.slice(prefixStart, previewStart)),
      styleFg(COLOR_TEXT)(line.slice(previewStart, bounds.end)),
      styleFg(COLOR_BORDER)(`${line.slice(bounds.end)}${suffix}`),
    ];
  }
  const labelStart = previewStart + 1;
  const labelEnd = labelStart + label.length;
  return [
    styleFg(COLOR_BORDER)(line.slice(prefixStart, labelStart)),
    bold(styleFg(COLOR_PREVIEW_LABEL)(line.slice(labelStart, labelEnd))),
    styleFg(COLOR_TEXT)(line.slice(labelEnd, bounds.end)),
    styleFg(COLOR_BORDER)(`${line.slice(bounds.end)}${suffix}`),
  ];
}

function findNextNonSpace(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] !== " ") return index;
  }
  return -1;
}

function findNextSpace(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === " ") return index;
  }
  return text.length;
}
