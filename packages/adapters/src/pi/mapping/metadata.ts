import type { MappingDef } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { type PiEnvelope, stringValue } from "../source.ts";
import type { PiMappingContext } from "./context.ts";
import { metaFor } from "./shared.ts";

export function metadataMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const modelChange = defineMapping<PiEnvelope>({
    match: { type: "model_change" },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      const toModel = stringValue(record.modelId);
      if (toModel === undefined) return [];
      const provider = stringValue(record.provider);
      return [
        {
          // from_model is filled by piModelChangeFromModel (needs prior model).
          type: "model_change",
          payload: { to_model: toModel },
          source: ctx.src(record, "model_change"),
          meta: metaFor(
            record,
            "model_change_envelope",
            provider !== undefined ? { "dev.pi.model_change": { provider } } : undefined,
          ),
        },
      ];
    },
  });

  const thinkingLevelChange = defineMapping<PiEnvelope>({
    match: { type: "thinking_level_change" },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      const level = stringValue(record.thinkingLevel);
      if (level === undefined) return [];
      return [
        {
          type: "thinking_level_change",
          payload: {
            to_level: level,
            trigger: "runtime_inferred",
          },
          source: ctx.src(record, "thinking_level_change"),
          meta: metaFor(record, "thinking_level_change_envelope"),
        },
      ];
    },
  });

  const sessionInfo = defineMapping<PiEnvelope>({
    match: { type: "session_info" },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      const name = stringValue(record.name);
      if (name === undefined) return [];
      return [
        {
          type: "session_metadata_update",
          payload: { field: "name", value: name, reason: "ai_generated" },
          source: ctx.src(record, "session_info"),
          meta: metaFor(record, "session_info_envelope"),
        },
      ];
    },
  });

  return [modelChange, thinkingLevelChange, sessionInfo];
}
