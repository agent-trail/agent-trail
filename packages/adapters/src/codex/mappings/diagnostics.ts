import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { isObject, stringValue } from "../source.ts";
import { diagnosticSourcePayload, emittable, meta, payloadOf, type Raw, source } from "./shared.ts";

function diagnosticCode(payload: Raw): string | undefined {
  const info = payload.codex_error_info;
  if (typeof info === "string") return info;
  if (isObject(info)) {
    const direct = stringValue(info.code) ?? stringValue(info.type);
    if (direct !== undefined) return direct;
    const variant = Object.keys(info).find((key) => key !== "code" && key !== "type");
    if (variant !== undefined) return variant;
  }
  return stringValue(payload.code);
}

function diagnosticMessageData(payload: Raw, severity: string): Raw {
  const data: Raw = { severity };
  const code = diagnosticCode(payload);
  if (code !== undefined) data.code = code;
  const message = stringValue(payload.message);
  if (message !== undefined) data.details = message;
  return data;
}

function diagnosticDraft(
  rawType: string,
  sourcePayload: Raw,
  kind: string,
  text: string,
  data: Raw,
): TrailEntryDraft {
  const payload: Raw = { kind, text };
  if (Object.keys(data).length > 0) payload.data = data;
  return {
    type: "system_event",
    payload,
    source: source(rawType, diagnosticSourcePayload(sourcePayload)),
    meta: meta(rawType),
  };
}

function messageDiagnostic(payloadType: string, kind: string, severity: string): MappingDef<Raw> {
  const rawType = `event_msg.${payloadType}`;
  return defineMapping<Raw>({
    match: { type: "event_msg", payload: { type: payloadType } },
    emit: (record) => {
      if (!emittable(record)) return [];
      const p = payloadOf(record);
      const text = stringValue(p.message) ?? "Codex diagnostic";
      return [diagnosticDraft(rawType, p, kind, text, diagnosticMessageData(p, severity))];
    },
  });
}

const modelReroute = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "model_reroute" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const from = stringValue(p.from_model) ?? stringValue(p.from);
    const to = stringValue(p.to_model) ?? stringValue(p.to);
    const reason = stringValue(p.reason);
    const data: Raw = {};
    if (from !== undefined) data.from = from;
    if (to !== undefined) data.to = to;
    if (reason !== undefined) data.reason = reason;
    const text =
      from !== undefined && to !== undefined ? `Model rerouted: ${from} → ${to}` : "Model rerouted";
    return [diagnosticDraft("event_msg.model_reroute", p, "model_rerouted", text, data)];
  },
});

const modelVerification = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "model_verification" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const verifications = Array.isArray(p.verifications)
      ? p.verifications.filter((item): item is string => typeof item === "string")
      : [];
    const data: Raw = { reason: "model_verification" };
    if (verifications.length > 0) data.details = verifications;
    return [
      diagnosticDraft(
        "event_msg.model_verification",
        p,
        "model_rerouted",
        "Model verification required",
        data,
      ),
    ];
  },
});

const deprecationNotice = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "deprecation_notice" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const text = stringValue(p.summary) ?? "Deprecation notice";
    const data: Raw = {};
    const details = stringValue(p.details);
    if (details !== undefined) data.details = details;
    return [diagnosticDraft("event_msg.deprecation_notice", p, "deprecation_notice", text, data)];
  },
});

const streamError = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "stream_error" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const text = stringValue(p.message) ?? "Stream error";
    const data: Raw = { severity: "error" };
    const code = diagnosticCode(p);
    if (code !== undefined) data.code = code;
    const details = stringValue(p.additional_details);
    if (details !== undefined) data.details = details;
    return [diagnosticDraft("event_msg.stream_error", p, "stream_error", text, data)];
  },
});

export const diagnosticMappings: MappingDef<Raw>[] = [
  messageDiagnostic("error", "agent_error", "error"),
  messageDiagnostic("warning", "agent_warning", "warning"),
  messageDiagnostic("guardian_warning", "guardian_alert", "warning"),
  modelReroute,
  modelVerification,
  deprecationNotice,
  streamError,
];
