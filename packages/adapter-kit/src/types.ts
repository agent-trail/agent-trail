import type { AgentName, Entry, SemanticMetadata, SourceMetadata } from "@agent-trail/types";
import type { RawRecord, SourceReader } from "./readers/types.ts";

/**
 * Transient cross-reference hints a pure mapping attaches to an emitted draft.
 * The reconciler consumes these in pass 2 and strips `meta.linker` before final
 * output — the trail `meta` field has no `linker` slot.
 */
export interface LinkerHints {
  call_id?: string;
}

/** Draft `meta` with the transient `linker` slot. Other keys are free-form. */
export type MetaWithLinker = { linker?: LinkerHints } & Record<string, unknown>;

/**
 * What a pure mapping (or override) emits in pass 1. The engine assigns `id`
 * and `ts`; the reconciler assigns `parent_id` (unless the draft sets it
 * explicitly). `payload`/`semantic`/`source` mirror the final `Entry`.
 */
export interface TrailEntryDraft {
  type: Entry["type"];
  payload?: Record<string, unknown>;
  semantic?: SemanticMetadata;
  source?: SourceMetadata;
  parent_id?: string | null;
  meta?: MetaWithLinker;
}

/**
 * Deep-partial structural matcher bound to the source record type `T`. Keys
 * present in the pattern must deep-equal the record; nested objects recurse.
 * e.g. `{ type: "response_item", payload: { type: "message" } }`. For the
 * default `RawRecord` this collapses to an open `{ [k: string]?: unknown }`.
 */
export type MatchPattern<T extends Record<string, unknown> = Record<string, unknown>> = {
  [K in keyof T]?: MatchPatternValue<T[K]>;
};

// Naked-parameter conditional so a union-typed property (e.g. `object | string`)
// distributes — each arm gets its own pattern shape rather than collapsing to
// the whole union. See PR #151 review.
type MatchPatternValue<V> = V extends Record<string, unknown> ? MatchPattern<V> : V;

export interface MappingDef<T extends RawRecord = RawRecord> {
  match: MatchPattern<T>;
  emit: (record: T) => TrailEntryDraft[];
}

export interface OverrideCtx<S> {
  /** Back-look over raw records already seen this parse (most recent last). */
  window: { recent(n: number): RawRecord[] };
  state: S;
  /** Emit a synthetic draft outside the matched record's own output. */
  emit(draft: TrailEntryDraft): void;
}

export interface OverrideDef<T extends RawRecord = RawRecord, S = unknown> {
  match: MatchPattern<T>;
  emit: (record: T, ctx: OverrideCtx<S>) => TrailEntryDraft[];
}

export interface ReconcilerRuleCtx {
  agent: AgentName;
}

export type ReconcilerRule = (entries: Entry[], ctx: ReconcilerRuleCtx) => Entry[];

export interface ReconcilerConfig {
  toolLinking?: boolean;
  parentChain?: boolean;
  cumulativeTokens?: boolean;
  branchReconciliation?: boolean;
  custom?: ReconcilerRule[];
}

export interface AdapterDef<S = unknown> {
  agent: AgentName;
  /**
   * Source-schema registry key for `selectSchemaVersion` / `validateSourceRecord`,
   * when it differs from the emitted `agent`. Defaults to `agent`. Needed when the
   * upstream schema is registered under a short name (e.g. Codex: emitted agent
   * `"codex-cli"`, schema key `"codex"`).
   */
  schemaAgent?: string;
  /** UUID namespace for synthesized entry ids (spec §8.5). */
  idNamespace: string;
  /** Vendor namespace for quarantine `system_event` kinds (kebab-case). */
  quarantineNamespace: string;
  sourceFormatVersions: string[];
  reader: SourceReader;
  /** Extract the ISO-8601 entry timestamp from a source record. */
  tsFrom: (record: RawRecord) => string;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous mapping inputs
  mappings: MappingDef<any>[];
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous override inputs
  overrides?: OverrideDef<any, S>[];
  initialState?: () => S;
  reconciler: ReconcilerConfig;
}

export interface ParseOptions {
  /** Stable per-session id used to seed synthesized entry ids. */
  sessionUid: string;
}
