import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { systemEventData, systemEventKind, systemEventText } from "../envelope-mappers.ts";
import { type CcEnvelope, isObject, jsonObjectValue, stringValue } from "../source.ts";
import { gate, hookFailureDraft, meta, type Raw, src } from "./shared.ts";

function isSessionEndProgress(record: CcEnvelope): boolean {
  if (record.type !== "progress") return false;
  const data = jsonObjectValue(record.data);
  return (
    stringValue(data?.type) === "hook_progress" && stringValue(data?.hookEvent) === "SessionEnd"
  );
}

function systemEvent(payloadType: string, allowNoUuid: boolean): MappingDef<Raw> {
  return defineMapping<Raw>({
    match: { type: payloadType },
    emit: (raw) => {
      const record = raw as CcEnvelope;
      if (!gate(record, allowNoUuid)) return [];
      const synthesized = typeof record.uuid !== "string";
      if (isSessionEndProgress(record)) {
        return [
          {
            type: "session_end",
            payload: { reason: "complete" },
            source: src(
              record,
              payloadType,
              undefined,
              undefined,
              synthesized ? { synthesized: true } : undefined,
            ),
            meta: meta(record),
          },
        ];
      }
      const data = systemEventData(record);
      const drafts: TrailEntryDraft[] = [
        {
          type: "system_event",
          payload: {
            kind: systemEventKind(record),
            text: systemEventText(record),
            ...(data !== undefined ? { data } : {}),
          },
          source: src(
            record,
            payloadType,
            undefined,
            undefined,
            synthesized ? { synthesized: true } : undefined,
          ),
          meta: meta(record),
        },
      ];
      if (
        record.type === "system" &&
        stringValue(record.subtype) === "stop_hook_summary" &&
        Array.isArray(record.hookErrors)
      ) {
        drafts.push(
          ...record.hookErrors.filter(isObject).map((error, index) =>
            hookFailureDraft(record, "system.stop_hook_summary.hook_error", error, {
              sourceBlock: error,
              sourceBlockIndex: index,
            }),
          ),
        );
      }
      return drafts;
    },
  });
}

const permissionMode = defineMapping<Raw>({
  match: { type: "permission-mode" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const mode = stringValue(record.permissionMode);
    if (mode === undefined) return [];
    // Base entry; ccPermissionModeDelta fills from_mode from the prior mode.
    return [
      {
        type: "mode_change",
        payload: {
          scope: "permission",
          to_mode: mode,
        },
        source: src(record, "permission-mode", undefined, undefined, { synthesized: true }),
        meta: meta(record),
      },
    ];
  },
});

export const systemMappings: MappingDef<Raw>[] = [
  systemEvent("system", false),
  systemEvent("progress", false),
  systemEvent("queue-operation", true),
  systemEvent("pr-link", true),
  permissionMode,
];
