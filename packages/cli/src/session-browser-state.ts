import type { CliResult } from "./command.ts";
import type { Row } from "./list-model.ts";

export type SessionBrowserRow = Row;

export type BrowserScopeMode = "cwd" | "all";

export type BrowserScope = {
  mode: BrowserScopeMode;
  label: string;
};

export type TrailFilter = "all" | "registered" | "unregistered";

export type SessionBrowserActionResult = {
  message: string;
  rows?: SessionBrowserRow[];
  url?: string;
};

export type SessionBrowserActionContext = {
  confirm: (message: string) => Promise<boolean>;
};

export type SessionBrowserResumeContext = {
  beforeSpawn: () => void;
};

export type SessionBrowserInput = {
  rows: SessionBrowserRow[];
  warnings: string[];
  scope?: BrowserScope;
  onToggleScope?: (nextScope: BrowserScopeMode) => Promise<SessionBrowserInput>;
  onShare?: (
    row: SessionBrowserRow,
    context?: SessionBrowserActionContext,
  ) => Promise<SessionBrowserActionResult>;
  onExport?: (row: SessionBrowserRow) => Promise<SessionBrowserActionResult>;
  onCopyUrl?: (url: string) => Promise<SessionBrowserActionResult>;
  onResume?: (row: SessionBrowserRow, context?: SessionBrowserResumeContext) => Promise<CliResult>;
};

export type BrowserState = SessionBrowserInput & {
  scope: BrowserScope;
  trailFilter: TrailFilter;
  agentFilter: string | null;
  query: string;
  searchMode: boolean;
  selectedIndex: number;
  openedIdentity: string | null;
  loading: boolean;
  actionMessage: string | null;
  latestShareUrl: string | null;
  shareUrls: Map<string, string>;
};

export const MISSING = "-";

// biome-ignore lint/complexity/useRegexLiterals: literal form trips noControlCharactersInRegex.
const ANSI_ESCAPE_RE = new RegExp(
  "\\u001B(?:\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)|[PX^_][^\\u001B]*(?:\\u001B\\\\)|\\[[0-?]*[ -/]*[@-~]|[@-Z\\\\-_])",
  "g",
);

export function defaultScope(): BrowserScope {
  return { mode: "cwd", label: MISSING };
}

export function browserStateFromInput(input: SessionBrowserInput | BrowserState): BrowserState {
  return "query" in input
    ? input
    : {
        ...input,
        scope: input.scope ?? defaultScope(),
        trailFilter: "all",
        agentFilter: null,
        query: "",
        searchMode: false,
        selectedIndex: 0,
        openedIdentity: null,
        loading: false,
        actionMessage: null,
        latestShareUrl: null,
        shareUrls: new Map(),
      };
}

export function filteredRows(state: BrowserState): SessionBrowserRow[] {
  const query = state.query.trim().toLowerCase();
  return state.rows.filter((row) => {
    if (!rowMatchesTrailFilter(row, state.trailFilter)) return false;
    if (!rowMatchesAgentFilter(row, state.agentFilter)) return false;
    return query.length === 0 || rowSearchText(row).toLowerCase().includes(query);
  });
}

export function clampSelection(state: BrowserState): void {
  const count = filteredRows(state).length;
  if (count === 0) {
    state.selectedIndex = 0;
    return;
  }
  state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, count - 1));
}

export function selectedWindowStart(
  selectedIndex: number,
  rowCount: number,
  visibleRows: number,
): number {
  if (visibleRows <= 0) return 0;
  if (rowCount <= visibleRows) return 0;
  return Math.min(Math.max(0, selectedIndex - visibleRows + 1), rowCount - visibleRows);
}

export function shortIdentity(row: SessionBrowserRow): string {
  const id = row.source_id ?? row.content_hash ?? MISSING;
  return sanitizeTerminalText(id).slice(0, 12);
}

export function rowIdentity(row: SessionBrowserRow): string {
  return row.source_id ?? row.content_hash ?? "";
}

export function renderValue(value: string | null): string {
  return value === null ? MISSING : sanitizeTerminalText(value);
}

export function rowDisplayName(row: SessionBrowserRow): string {
  return sanitizeTerminalText(row.display_name ?? rowFileName(row));
}

export function rowProjectName(row: SessionBrowserRow): string {
  const cwd = row.cwd ?? row.source_cwd ?? row.registered_cwd;
  if (cwd === null) return MISSING;
  const clean = sanitizeTerminalText(cwd).trim();
  const normalized = clean.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? clean;
}

export function rowPreviewName(row: SessionBrowserRow): string {
  return sanitizeTerminalText(row.display_name ?? rowFileName(row));
}

export function trailAvailability(row: SessionBrowserRow): string {
  return row.content_hash === null ? "NO" : "YES";
}

export function formatLocalDate(value: string | null): string {
  if (value === null) return MISSING;
  const clean = sanitizeTerminalText(value);
  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) return clean;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

export function formatSerial(value: number): string {
  return value < 100 ? value.toString().padStart(2, "0") : value.toString();
}

export function scopeLabel(scope: BrowserScope): string {
  return sanitizeTerminalText(scope.mode === "all" ? "all" : scope.label);
}

export function searchLabel(state: BrowserState): string {
  const query = sanitizeTerminalText(state.query);
  if (!state.searchMode) return query.length === 0 ? MISSING : query;
  return `${query}_`;
}

export function nextTrailFilter(filter: TrailFilter): TrailFilter {
  if (filter === "all") return "registered";
  if (filter === "registered") return "unregistered";
  return "all";
}

export function trailFilterLabel(filter: TrailFilter): string {
  if (filter === "registered") return "YES";
  if (filter === "unregistered") return "NO";
  return "all";
}

export function agentFilterLabel(filter: string | null): string {
  return filter === null ? "all" : sanitizeTerminalText(filter);
}

export function nextAgentFilter(state: BrowserState): string | null {
  const agents = sortedAgents(state.rows);
  if (agents.length === 0) return null;
  if (state.agentFilter === null) return agents[0] ?? null;
  const index = agents.indexOf(state.agentFilter);
  if (index === -1 || index === agents.length - 1) return null;
  return agents[index + 1] ?? null;
}

export function sortedAgents(rows: readonly SessionBrowserRow[]): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row.agent)
        .filter((agent): agent is string => agent !== null)
        .map(sanitizeTerminalText),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export function sanitizeTerminalText(value: string): string {
  let sanitized = "";
  for (const char of value.replace(ANSI_ESCAPE_RE, "")) {
    const code = char.charCodeAt(0);
    sanitized += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : char;
  }
  return sanitized;
}

export function exitResult(state: BrowserState): CliResult {
  const warnings = state.warnings.map(sanitizeTerminalText);
  return {
    exitCode: 0,
    stdout: "",
    stderr: warnings.length === 0 ? "" : `${warnings.join("\n")}\n`,
  };
}

function rowMatchesTrailFilter(row: SessionBrowserRow, filter: TrailFilter): boolean {
  if (filter === "all") return true;
  const registered = row.content_hash !== null;
  return filter === "registered" ? registered : !registered;
}

function rowMatchesAgentFilter(row: SessionBrowserRow, filter: string | null): boolean {
  return filter === null || row.agent === filter;
}

function rowSearchText(row: SessionBrowserRow): string {
  return Object.values(row)
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function rowFileName(row: SessionBrowserRow): string {
  const path = row.source_path ?? row.registered_source_path;
  if (path === null) return shortIdentity(row);
  const clean = sanitizeTerminalText(path).trim();
  const normalized = clean.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  const name = parts[parts.length - 1];
  return name === undefined || name.length === 0 ? shortIdentity(row) : name;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
