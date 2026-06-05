import type { PiEnvelope } from "../source.ts";

/**
 * Internal parenting hint stashed on `meta` by the mappings and consumed +
 * stripped by `piParentResolution` (reconcile-rules.ts). Carries the Pi source
 * id and parent source id (and, for branch summaries, the raw `fromId`) so the
 * tree topology — which the kit engine cannot see from a per-record mapping —
 * can be rebuilt after ids are assigned. Never appears in final output.
 */
export const PARENT_HINT = "x-pi/_h";

export interface ParentHint {
  sid: string;
  pid: string | null;
  fromId?: string;
  /**
   * Model of the source assistant envelope, carried on every entry it emits so
   * piModelChangeFromModel can advance `prevModel` per source envelope (matching
   * v1) — including tool_call-only / thinking-only messages whose entries carry
   * no model in their own payload.
   */
  model?: string;
}

export type Meta = Record<string, unknown>;

export interface HintExtras {
  fromId?: string;
  model?: string;
}

export function metaFor(
  record: PiEnvelope,
  rawType: string,
  extra?: Meta,
  hintExtras?: HintExtras,
): Meta {
  const hint: ParentHint = {
    sid: record.id as string,
    pid: record.parentId ?? null,
    ...(hintExtras?.fromId !== undefined ? { fromId: hintExtras.fromId } : {}),
    ...(hintExtras?.model !== undefined ? { model: hintExtras.model } : {}),
  };
  return {
    ...(extra ?? {}),
    "dev.pi.raw_type": rawType,
    [PARENT_HINT]: hint,
  };
}
