import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { isObject, stringValue } from "../source.ts";
import { emittable, meta, payloadOf, type Raw, source } from "./shared.ts";

function capabilityMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  const namespace = stringValue(value.namespace);
  if (namespace !== undefined) metadata.namespace = namespace;
  const description = stringValue(value.description);
  if (description !== undefined) metadata.description = description;
  const deferLoading = value.defer_loading ?? value.deferLoading;
  if (typeof deferLoading === "boolean") metadata.defer_loading = deferLoading;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

const sessionDynamicTools = defineMapping<Raw>({
  match: { type: "session_meta" },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const tools = Array.isArray(p.dynamic_tools)
      ? p.dynamic_tools
      : Array.isArray(p.dynamicTools)
        ? p.dynamicTools
        : [];
    const snapshot = tools.flatMap((tool) => {
      if (!isObject(tool)) return [];
      const name = stringValue(tool.name);
      if (name === undefined) return [];
      const metadata = capabilityMetadata(tool);
      return [{ name, ...(metadata !== undefined ? { metadata } : {}) }];
    });
    if (snapshot.length === 0) return [];
    return [
      {
        type: "capability_change",
        payload: { scope: "tool", reason: "loaded", snapshot },
        source: source("session_meta.dynamic_tools"),
        meta: meta("session_meta.dynamic_tools"),
      },
    ];
  },
});

function mcpStatusState(status: unknown): string | undefined {
  if (typeof status === "string") return status;
  if (!isObject(status)) return undefined;
  return stringValue(status.state);
}

function mcpStatusError(status: unknown): string | undefined {
  return isObject(status) ? stringValue(status.error) : undefined;
}

const mcpStartupUpdate = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "mcp_startup_update" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const name = stringValue(p.server);
    if (name === undefined) return [];
    const state = mcpStatusState(p.status);
    if (state === "starting") {
      return [
        {
          type: "capability_change",
          payload: { scope: "mcp_server", reason: "loaded", added: [{ name }] },
          source: source("event_msg.mcp_startup_update"),
          meta: meta("event_msg.mcp_startup_update"),
        },
      ];
    }
    if (state === "ready") {
      return [
        {
          type: "capability_change",
          payload: { scope: "mcp_server", reason: "connected", added: [{ name }] },
          source: source("event_msg.mcp_startup_update"),
          meta: meta("event_msg.mcp_startup_update"),
        },
      ];
    }
    if (state === "failed") {
      return [
        {
          type: "capability_change",
          payload: {
            scope: "mcp_server",
            reason: "error",
            changed: [
              {
                name,
                field: "error",
                to: mcpStatusError(p.status) ?? "failed",
              },
            ],
          },
          source: source("event_msg.mcp_startup_update"),
          meta: meta("event_msg.mcp_startup_update"),
        },
      ];
    }
    if (state === "cancelled") {
      return [
        {
          type: "capability_change",
          payload: { scope: "mcp_server", reason: "disconnected", removed: [{ name }] },
          source: source("event_msg.mcp_startup_update"),
          meta: meta("event_msg.mcp_startup_update"),
        },
      ];
    }
    return [];
  },
});

const mcpStartupComplete = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "mcp_startup_complete" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const drafts: TrailEntryDraft[] = [];
    const ready = Array.isArray(p.ready)
      ? p.ready.filter((item): item is string => typeof item === "string").map((name) => ({ name }))
      : [];
    if (ready.length > 0) {
      drafts.push({
        type: "capability_change",
        payload: { scope: "mcp_server", reason: "connected", added: ready },
        source: source("event_msg.mcp_startup_complete"),
        meta: meta("event_msg.mcp_startup_complete"),
      });
    }

    const failed = Array.isArray(p.failed)
      ? p.failed.flatMap((item) => {
          if (!isObject(item)) return [];
          const name = stringValue(item.server);
          if (name === undefined) return [];
          return [
            {
              name,
              field: "error",
              to: stringValue(item.error) ?? "failed",
            },
          ];
        })
      : [];
    if (failed.length > 0) {
      drafts.push({
        type: "capability_change",
        payload: { scope: "mcp_server", reason: "error", changed: failed },
        source: source("event_msg.mcp_startup_complete"),
        meta: meta("event_msg.mcp_startup_complete"),
      });
    }

    const cancelled = Array.isArray(p.cancelled)
      ? p.cancelled
          .filter((item): item is string => typeof item === "string")
          .map((name) => ({ name }))
      : [];
    if (cancelled.length > 0) {
      drafts.push({
        type: "capability_change",
        payload: { scope: "mcp_server", reason: "disconnected", removed: cancelled },
        source: source("event_msg.mcp_startup_complete"),
        meta: meta("event_msg.mcp_startup_complete"),
      });
    }

    return drafts;
  },
});

export const sessionCapabilityMappings: MappingDef<Raw>[] = [sessionDynamicTools];

export const mcpCapabilityMappings: MappingDef<Raw>[] = [mcpStartupUpdate, mcpStartupComplete];
