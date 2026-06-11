import type { JsonlRecord } from "@agent-trail/core";

export type Visit = {
  recordIndex: number;
  location: string;
  get: () => string;
  set: (next: string) => void;
};

function arrayVisit(
  container: unknown[],
  index: number,
  recordIndex: number,
  location: string,
): Visit {
  return {
    recordIndex,
    location,
    get: () => container[index] as string,
    set: (next) => {
      container[index] = next;
    },
  };
}

export function keyVisit(
  container: Record<string, unknown>,
  key: string,
  recordIndex: number,
  location: string,
): Visit {
  return {
    recordIndex,
    location,
    get: () => container[key] as string,
    set: (next) => {
      container[key] = next;
    },
  };
}

function* walkContainer(
  container: Record<string, unknown> | unknown[],
  recordIndex: number,
  prefix: string,
): Generator<Visit> {
  if (Array.isArray(container)) {
    for (let i = 0; i < container.length; i += 1) {
      const child = container[i];
      const path = `${prefix}[${i}]`;
      if (typeof child === "string") {
        yield arrayVisit(container, i, recordIndex, path);
      } else if (child !== null && typeof child === "object") {
        yield* walkContainer(child as Record<string, unknown> | unknown[], recordIndex, path);
      }
    }
    return;
  }
  for (const [key, child] of Object.entries(container)) {
    const path = `${prefix}.${key}`;
    if (typeof child === "string") {
      yield keyVisit(container, key, recordIndex, path);
    } else if (child !== null && typeof child === "object") {
      yield* walkContainer(child as Record<string, unknown> | unknown[], recordIndex, path);
    }
  }
}

// Event `type` values whose payloads are walked by an explicit branch below.
// Any other type falls into the generic walk so unknown / future / vendor
// events still get redacted.
const HANDLED_EVENT_TYPES = new Set<string>([
  "session",
  "agent_message",
  "user_message",
  "session_summary",
  "agent_thinking",
  "system_event",
  "user_interrupt",
  "branch_point",
  "context_compact",
  "branch_summary",
  "tool_call",
  "tool_result",
  "tool_call_aborted",
  "user_query",
  "user_query_response",
  "capability_change",
  "session_metadata_update",
]);

// Attachment references (image/file uris) appear on user_message, agent_message,
// and tool_result payloads (spec §9.2). They carry potentially sensitive uris
// (local file: paths leaking home/username, https: with tokens), so scrub them
// the same way wherever they appear.
function* visitAttachments(payload: Record<string, unknown>, index: number): Generator<Visit> {
  const attachments = payload.attachments;
  if (!Array.isArray(attachments)) return;
  for (let i = 0; i < attachments.length; i += 1) {
    const a = attachments[i];
    if (a === null || typeof a !== "object") continue;
    const obj = a as Record<string, unknown>;
    if (typeof obj.uri === "string") {
      yield keyVisit(obj, "uri", index, `records[${index}].payload.attachments[${i}].uri`);
    }
    if (typeof obj.name === "string") {
      yield keyVisit(obj, "name", index, `records[${index}].payload.attachments[${i}].name`);
    }
  }
}

function* visitObjectMember(
  container: Record<string, unknown>,
  key: string,
  recordIndex: number,
  path: string,
): Generator<Visit> {
  const value = container[key];
  if (typeof value === "string") {
    yield keyVisit(container, key, recordIndex, path);
  } else if (value !== null && typeof value === "object") {
    yield* walkContainer(value as Record<string, unknown> | unknown[], recordIndex, path);
  }
}

function* visitLabelMetadata(value: Record<string, unknown>, index: number): Generator<Visit> {
  for (const key of ["name", "description", "tags"] as const) {
    yield* visitObjectMember(value, key, index, `records[${index}].${key}`);
  }
}

export function* visitStrings(records: JsonlRecord[], includeSourceRaw: boolean): Generator<Visit> {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    const payload = value.payload as Record<string, unknown> | undefined;
    const type = value.type;

    if (type === "session") {
      yield* visitLabelMetadata(value, index);
      if (typeof value.cwd === "string") {
        yield keyVisit(value, "cwd", index, `records[${index}].cwd`);
      }
      const vcs = value.vcs as Record<string, unknown> | undefined;
      if (vcs !== undefined) {
        yield* visitVcsStrings(vcs, index, `records[${index}].vcs`);
      }
      const headerSource = value.source as Record<string, unknown> | undefined;
      if (headerSource && typeof headerSource.path === "string") {
        yield keyVisit(headerSource, "path", index, `records[${index}].source.path`);
      }
    }

    if (type === "trail") {
      yield* visitLabelMetadata(value, index);
      // Trail envelope carries vcs in the same shape as the session header.
      const vcs = value.vcs as Record<string, unknown> | undefined;
      if (vcs !== undefined) {
        yield* visitVcsStrings(vcs, index, `records[${index}].vcs`);
      }
    }

    if (
      payload &&
      (type === "agent_message" ||
        type === "user_message" ||
        type === "session_summary" ||
        type === "agent_thinking" ||
        type === "system_event") &&
      typeof payload.text === "string"
    ) {
      yield keyVisit(payload, "text", index, `records[${index}].payload.text`);
    }

    if (payload && type === "user_interrupt" && typeof payload.reason === "string") {
      yield keyVisit(payload, "reason", index, `records[${index}].payload.reason`);
    }

    if (payload && type === "branch_point" && typeof payload.reason === "string") {
      yield keyVisit(payload, "reason", index, `records[${index}].payload.reason`);
    }

    if (
      payload &&
      (type === "context_compact" || type === "branch_summary") &&
      typeof payload.summary === "string"
    ) {
      yield keyVisit(payload, "summary", index, `records[${index}].payload.summary`);
    }

    if (payload && (type === "user_message" || type === "agent_message")) {
      yield* visitAttachments(payload, index);
    }

    if (payload && (type === "user_query" || type === "user_query_response")) {
      yield* walkContainer(payload, index, `records[${index}].payload`);
    }

    if (payload && type === "system_event") {
      const data = payload.data;
      if (data !== null && typeof data === "object") {
        yield* walkContainer(
          data as Record<string, unknown> | unknown[],
          index,
          `records[${index}].payload.data`,
        );
      }
    }

    if (payload && type === "session_metadata_update") {
      if (payload.field === "vcs.worktree") {
        yield* visitWorktreeMetadataMember(
          payload,
          "value",
          index,
          `records[${index}].payload.value`,
        );
        yield* visitWorktreeMetadataMember(
          payload,
          "previous_value",
          index,
          `records[${index}].payload.previous_value`,
        );
      } else {
        yield* visitObjectMember(payload, "value", index, `records[${index}].payload.value`);
        yield* visitObjectMember(
          payload,
          "previous_value",
          index,
          `records[${index}].payload.previous_value`,
        );
      }
    }

    if (payload && type === "tool_call") {
      const args = payload.args;
      if (args !== null && typeof args === "object") {
        yield* walkContainer(
          args as Record<string, unknown> | unknown[],
          index,
          `records[${index}].payload.args`,
        );
      }
      if (typeof payload.overflow_ref === "string") {
        yield keyVisit(payload, "overflow_ref", index, `records[${index}].payload.overflow_ref`);
      }
    }

    if (payload && type === "tool_result") {
      if (typeof payload.output === "string") {
        yield keyVisit(payload, "output", index, `records[${index}].payload.output`);
      }
      if (typeof payload.error === "string") {
        yield keyVisit(payload, "error", index, `records[${index}].payload.error`);
      }
      if (typeof payload.overflow_ref === "string") {
        yield keyVisit(payload, "overflow_ref", index, `records[${index}].payload.overflow_ref`);
      }
      yield* visitAttachments(payload, index);
      const resultMeta = payload.meta;
      if (resultMeta !== null && typeof resultMeta === "object") {
        yield* walkContainer(
          resultMeta as Record<string, unknown> | unknown[],
          index,
          `records[${index}].payload.meta`,
        );
      }
    }

    if (payload && type === "tool_call_aborted" && typeof payload.blocked_by === "string") {
      yield keyVisit(payload, "blocked_by", index, `records[${index}].payload.blocked_by`);
    }

    if (payload && type === "capability_change") {
      yield* walkContainer(payload, index, `records[${index}].payload`);
    }

    // Forward-compat fallback: schema permits future event types whose
    // payloads are still arbitrary string-bearing objects. For any type not
    // already handled above, walk payload generically so unknown adapters
    // and vendor events do not bypass redaction.
    if (payload && typeof type === "string" && !HANDLED_EVENT_TYPES.has(type)) {
      yield* walkContainer(payload, index, `records[${index}].payload`);
    }

    const meta = value.meta;
    if (meta !== null && typeof meta === "object") {
      yield* walkContainer(
        meta as Record<string, unknown> | unknown[],
        index,
        `records[${index}].meta`,
      );
    }

    if (includeSourceRaw && type !== "session") {
      const source = value.source as Record<string, unknown> | undefined;
      const raw = source?.raw;
      if (raw !== undefined && raw !== null && typeof raw === "object") {
        yield* walkContainer(
          raw as Record<string, unknown> | unknown[],
          index,
          `records[${index}].source.raw`,
        );
      } else if (typeof raw === "string" && source) {
        yield keyVisit(source, "raw", index, `records[${index}].source.raw`);
      }
    }
  }
}

function* visitVcsStrings(
  vcs: Record<string, unknown>,
  recordIndex: number,
  path: string,
): Generator<Visit> {
  if (typeof vcs.branch === "string") yield keyVisit(vcs, "branch", recordIndex, `${path}.branch`);
  const worktree = vcs.worktree as Record<string, unknown> | undefined;
  if (worktree === undefined) return;
  yield* visitWorktreeStrings(worktree, recordIndex, `${path}.worktree`);
}

function* visitWorktreeMetadataMember(
  container: Record<string, unknown>,
  key: "value" | "previous_value",
  recordIndex: number,
  path: string,
): Generator<Visit> {
  const value = container[key];
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    yield* visitWorktreeStrings(value as Record<string, unknown>, recordIndex, path);
  }
}

function* visitWorktreeStrings(
  worktree: Record<string, unknown>,
  recordIndex: number,
  path: string,
): Generator<Visit> {
  for (const key of ["name", "path", "original_cwd", "original_branch"] as const) {
    if (typeof worktree[key] === "string") {
      yield keyVisit(worktree, key, recordIndex, `${path}.${key}`);
    }
  }
}
