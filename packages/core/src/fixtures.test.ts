import { expect, test } from "bun:test";
import { validateTrailString } from "./index.ts";

const FIXTURES = new URL("../../../tests/fixtures/validation/", import.meta.url);
const loadFixture = (rel: string) => Bun.file(new URL(rel, FIXTURES)).text();

test("valid/minimal-linear.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/minimal-linear.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/minimal-with-content-hash.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/minimal-with-content-hash.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/linear-with-parent-ids.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/linear-with-parent-ids.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/streaming-open.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/streaming-open.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/streaming-finalized-clean.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/streaming-finalized-clean.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/agent-message-usage.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/agent-message-usage.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-call-usage.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-call-usage.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/agent-thinking-usage.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/agent-thinking-usage.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/agent-message-attachments.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/agent-message-attachments.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/agent-message-attachments-multiple.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/agent-message-attachments-multiple.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/context-compact-replaced-message-ids.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/context-compact-replaced-message-ids.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/context-compact-provenance-only-ids.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/context-compact-provenance-only-ids.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/capability-change.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/capability-change.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/session-metadata-update-name.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/session-metadata-update-name.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/session-header-metadata-base.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/session-header-metadata-base.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/session-metadata-update-tags.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/session-metadata-update-tags.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/session-metadata-update-agent-model-default.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/session-metadata-update-agent-model-default.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/session-metadata-update-vcs-branch.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/session-metadata-update-vcs-branch.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/session-metadata-update-vendor.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/session-metadata-update-vendor.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-schema/agent-message-attachment-bad-uri.trail.jsonl reports pattern at /payload/attachments/0/uri", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/agent-message-attachment-bad-uri.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/attachments/0/uri",
    severity: "error",
    code: "pattern",
    message: 'must match pattern "^(https:|file:|sha256:)"',
  });
});

test("invalid-schema/agent-message-usage-extra-field.trail.jsonl reports additionalProperties at /payload/usage/cost_usd", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/agent-message-usage-extra-field.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/usage/cost_usd",
    severity: "error",
    code: "additionalProperties",
    message: "must NOT have additional properties",
  });
});

test("invalid-schema/agent-message-usage-missing-required.trail.jsonl rejects usage missing input pair", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/agent-message-usage-missing-required.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/usage",
    severity: "error",
    code: "anyOf",
    message: "must match a schema in anyOf",
  });
});

test("invalid-schema/agent-message-usage-missing-output.trail.jsonl rejects usage missing output pair", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/agent-message-usage-missing-output.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/usage",
    severity: "error",
    code: "anyOf",
    message: "must match a schema in anyOf",
  });
});

test("invalid-schema/tool-call-usage-missing-output.trail.jsonl rejects usage missing output pair", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-call-usage-missing-output.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/usage",
    severity: "error",
    code: "anyOf",
    message: "must match a schema in anyOf",
  });
});

test("invalid-schema/agent-thinking-usage-missing-output.trail.jsonl rejects usage missing output pair", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/agent-thinking-usage-missing-output.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/usage",
    severity: "error",
    code: "anyOf",
    message: "must match a schema in anyOf",
  });
});

test("invalid-schema/agent-message-usage-zero-context-window.trail.jsonl rejects zero context window", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/agent-message-usage-zero-context-window.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/usage/context_window_tokens",
    severity: "error",
    code: "minimum",
    message: "must be >= 1",
  });
});

test("invalid-schema/header-wrong-schema-version.trail.jsonl reports const + missing_header", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/header-wrong-schema-version.trail.jsonl"),
  );
  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/schema_version",
      severity: "error",
      code: "const",
      message: "must be equal to constant",
    },
    {
      line: 1,
      path: "",
      severity: "error",
      code: "missing_header",
      message: 'First line must be a session header with type "session" and schema_version "0.1.0"',
    },
  ]);
});

test("invalid-schema/user-message-missing-text.trail.jsonl reports required /payload/text", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/user-message-missing-text.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/text",
    severity: "error",
    code: "required",
    message: "must have required property 'text'",
  });
});

test("invalid-schema/capability-change-bad-scope.trail.jsonl reports enum at /payload/scope", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/capability-change-bad-scope.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/scope",
    severity: "error",
    code: "enum",
    message: "must be equal to one of the allowed values",
  });
});

test("invalid-schema/capability-change-bad-reason.trail.jsonl reports enum at /payload/reason", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/capability-change-bad-reason.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/reason",
    severity: "error",
    code: "enum",
    message: "must be equal to one of the allowed values",
  });
});

test("invalid-schema/session-metadata-update-bad-field-cwd.trail.jsonl reports oneOf at /payload", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/session-metadata-update-bad-field-cwd.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload",
    severity: "error",
    code: "oneOf",
    message: "must match exactly one schema in oneOf",
  });
});

test("invalid-schema/session-metadata-update-bad-tags-value.trail.jsonl reports type at /payload/value", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/session-metadata-update-bad-tags-value.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/value",
    severity: "error",
    code: "type",
    message: "must be array",
  });
});

test("invalid-schema/session-metadata-update-bad-reason.trail.jsonl reports enum at /payload/reason", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/session-metadata-update-bad-reason.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/reason",
    severity: "error",
    code: "enum",
    message: "must be equal to one of the allowed values",
  });
});

test("invalid-schema/session-metadata-update-bad-worktree.trail.jsonl reports required at /payload/value/path", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/session-metadata-update-bad-worktree.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/value/path",
    severity: "error",
    code: "required",
    message: "must have required property 'path'",
  });
});

test("invalid-schema/capability-change-empty.trail.jsonl reports anyOf at /payload", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/capability-change-empty.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload",
    severity: "error",
    code: "anyOf",
    message: "must match a schema in anyOf",
  });
});

test("invalid-schema/tool-call-missing-args-path.trail.jsonl reports required /payload/args/path", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-call-missing-args-path.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/args/path",
    severity: "error",
    code: "required",
    message: "must have required property 'path'",
  });
});

test("valid/tool-call-file-patch.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-call-file-patch.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-call-file-list.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-call-file-list.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-schema/tool-call-file-patch-empty-files.trail.jsonl reports minItems at /payload/args/files", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-call-file-patch-empty-files.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/args/files",
    severity: "error",
    code: "minItems",
    message: "must NOT have fewer than 1 items",
  });
});

test("invalid-schema/tool-call-file-patch-file-missing-diff.trail.jsonl reports required /payload/args/files/0/diff", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-call-file-patch-file-missing-diff.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/args/files/0/diff",
    severity: "error",
    code: "required",
    message: "must have required property 'diff'",
  });
});

test("invalid-schema/tool-call-file-list-missing-path.trail.jsonl reports required /payload/args/path", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-call-file-list-missing-path.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/args/path",
    severity: "error",
    code: "required",
    message: "must have required property 'path'",
  });
});

test("invalid-schema/user-message-non-string-text.trail.jsonl reports type at /payload/text", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/user-message-non-string-text.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/text",
    severity: "error",
    code: "type",
    message: "must be string",
  });
});

test("invalid-graph/stream-open-with-content-hash.trail.jsonl warns about stream/hash conflict", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/stream-open-with-content-hash.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/content_hash",
    severity: "warning",
    code: "stream_open_with_content_hash",
    message:
      'Header has stream.state "open" but content_hash is populated; live files should omit content_hash or use "<pending>"',
  });
});

test("invalid-graph/duplicate-id.trail.jsonl reports duplicate_id at /id line 3", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/duplicate-id.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/id",
    severity: "error",
    code: "duplicate_id",
    message: 'Duplicate id "01HEVTA0000000000000000001"; first seen on line 2',
  });
});

test("invalid-graph/unknown-parent-id.trail.jsonl reports unknown_parent_id", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/unknown-parent-id.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/parent_id",
    severity: "error",
    code: "unknown_parent_id",
    message: 'parent_id "01HGH0ST000000000000000001" does not reference an id in this file',
  });
});

test("invalid-graph/parent-cycle.trail.jsonl reports parent_cycle on both lines", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/parent-cycle.trail.jsonl"),
  );
  const cycles = diagnostics.filter((d) => d.code === "parent_cycle");
  expect(cycles.map((d) => d.line)).toEqual([2, 3]);
});

test("valid/tool-call-matched-by-for-id.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-call-matched-by-for-id.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-call-matched-same-parent-siblings.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-call-matched-same-parent-siblings.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-graph/ambiguous-sequential-pairing.trail.jsonl warns on ambiguous fallback", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/ambiguous-sequential-pairing.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 4,
    path: "/payload",
    severity: "warning",
    code: "ambiguous_sequential_pairing",
    message:
      "tool_result was paired by sequential fallback with 2 unmatched prior tool_call candidates; writers should populate payload.for_id or semantic.call_id",
  });
});

test("invalid-graph/ambiguous-sequential-pairing-with-session-end.trail.jsonl keeps ambiguity warning", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/ambiguous-sequential-pairing-with-session-end.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 4,
    path: "/payload",
    severity: "warning",
    code: "ambiguous_sequential_pairing",
    message:
      "tool_result was paired by sequential fallback with 2 unmatched prior tool_call candidates; writers should populate payload.for_id or semantic.call_id",
  });
  expect(diagnostics.map((d) => d.code)).not.toContain("unmatched_tool_call_at_eof");
});

test("invalid-graph/sequential-pairing-stays-in-branch.trail.jsonl does not pair across inline subagent branch", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/sequential-pairing-stays-in-branch.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/id",
    severity: "warning",
    code: "unmatched_tool_call_at_eof",
    message:
      'tool_call "01HEVTA0000000000000000002" has no matching tool_result or call-scoped tool_call_aborted at EOF',
  });
  expect(diagnostics.map((d) => d.code)).not.toContain("ambiguous_sequential_pairing");
});

test("invalid-graph/sequential-pairing-stays-in-sibling-branch.trail.jsonl does not pair across sibling branches", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/sequential-pairing-stays-in-sibling-branch.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/id",
    severity: "warning",
    code: "unmatched_tool_call_at_eof",
    message:
      'tool_call "01HEVTA0000000000000000002" has no matching tool_result or call-scoped tool_call_aborted at EOF',
  });
  expect(diagnostics.map((d) => d.code)).not.toContain("ambiguous_sequential_pairing");
});

test("invalid-graph/sequential-pairing-stays-in-subagent-sibling-branch.trail.jsonl does not pair across sibling branches inside subagents", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture(
      "invalid-graph/sequential-pairing-stays-in-subagent-sibling-branch.trail.jsonl",
    ),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/id",
    severity: "warning",
    code: "unmatched_tool_call_at_eof",
    message:
      'tool_call "01HEVTA0000000000000000002" has no matching tool_result or call-scoped tool_call_aborted at EOF',
  });
  expect(diagnostics.map((d) => d.code)).not.toContain("ambiguous_sequential_pairing");
});

test("valid/tool-call-aborted-closes-call.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-call-aborted-closes-call.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-call-aborted-turn-scope.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-call-aborted-turn-scope.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-call-aborted-extension-scope-reason.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-call-aborted-extension-scope-reason.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-schema/tool-call-aborted-tool-scope-missing-for-id.trail.jsonl reports required /payload/for_id", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-call-aborted-tool-scope-missing-for-id.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/for_id",
    severity: "error",
    code: "required",
    message: "must have required property 'for_id'",
  });
});

test("invalid-schema/tool-call-aborted-turn-scope-with-for-id.trail.jsonl rejects for_id", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-call-aborted-turn-scope-with-for-id.trail.jsonl"),
  );
  expect(diagnostics.some((d) => d.line === 2 && d.path === "/payload")).toBe(true);
});

test("invalid-schema/tool-call-aborted-bad-reason.trail.jsonl rejects bare unknown reason", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-call-aborted-bad-reason.trail.jsonl"),
  );
  expect(diagnostics.some((d) => d.line === 2 && d.path === "/payload/reason")).toBe(true);
});

test("valid/tool-result-attachments.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-result-attachments.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-result-attachments-with-mcp-meta.trail.jsonl validates clean (attachments + meta.mcp_call coexist)", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-result-attachments-with-mcp-meta.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-schema/tool-result-attachment-extra-field.trail.jsonl reports additionalProperties at /payload/attachments/0/width", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-result-attachment-extra-field.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/attachments/0/width",
    severity: "error",
    code: "additionalProperties",
    message: "must NOT have additional properties",
  });
});

test("valid/tool-result-meta-mcp-call.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-result-meta-mcp-call.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-result-meta-shell-command.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-result-meta-shell-command.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-result-output-size-truncated.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-result-output-size-truncated.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/redaction-count-meta.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/redaction-count-meta.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-schema/tool-result-truncated-missing-output-size.trail.jsonl reports required output_size", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-result-truncated-missing-output-size.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/output_size",
    severity: "error",
    code: "required",
    message: "must have required property 'output_size'",
  });
});

test("invalid-schema/redaction-count-non-integer.trail.jsonl reports type error", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/redaction-count-non-integer.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/meta/redaction_count",
    severity: "error",
    code: "type",
    message: "must be integer",
  });
});

test("valid/command-invoke-minimal.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/command-invoke-minimal.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/command-invoke-full.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/command-invoke-full.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/command-invoke-result-action-ext.trail.jsonl validates clean (x- result_action)", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/command-invoke-result-action-ext.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/command-invoke-slash.trail.jsonl validates clean (slash kind, reserved result_action)", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/command-invoke-slash.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/command-invoke-plugin.trail.jsonl validates clean (plugin kind, agent_invoked, null result_action)", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/command-invoke-plugin.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-schema/command-invoke-missing-kind.trail.jsonl reports required /payload/kind", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/command-invoke-missing-kind.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/kind",
    severity: "error",
    code: "required",
    message: "must have required property 'kind'",
  });
});

test("invalid-schema/command-invoke-bad-result-action.trail.jsonl reports result_action mismatch", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/command-invoke-bad-result-action.trail.jsonl"),
  );
  expect(
    diagnostics.some((d) => d.severity === "error" && d.path === "/payload/result_action"),
  ).toBe(true);
});

test("invalid-schema/command-invoke-bad-kind.trail.jsonl reports enum at /payload/kind", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/command-invoke-bad-kind.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/kind",
    severity: "error",
    code: "enum",
    message: "must be equal to one of the allowed values",
  });
});

test("invalid-schema/command-invoke-missing-name.trail.jsonl reports required /payload/name", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/command-invoke-missing-name.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/name",
    severity: "error",
    code: "required",
    message: "must have required property 'name'",
  });
});

test("valid/tool-result-meta-file-read.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-result-meta-file-read.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-result-meta-unregistered-kind.trail.jsonl validates clean (opaque toolkind)", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-result-meta-unregistered-kind.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-result-meta-vendor-extension.trail.jsonl validates clean (x- key inside registered shape)", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-result-meta-vendor-extension.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-schema/tool-result-meta-shell-command-extra-field.trail.jsonl reports additionalProperties at /payload/meta/shell_command/exitcode", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-result-meta-shell-command-extra-field.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/meta/shell_command/exitcode",
    severity: "error",
    code: "additionalProperties",
    message: "must NOT have additional properties",
  });
});

test("valid/tool-result-meta-toplevel-vendor-kind.trail.jsonl validates clean (opaque vendor toolkind)", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-result-meta-toplevel-vendor-kind.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-schema/tool-result-meta-file-read-range-wrong-length.trail.jsonl reports maxItems at /payload/meta/file_read/range", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-result-meta-file-read-range-wrong-length.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/meta/file_read/range",
    severity: "error",
    code: "maxItems",
    message: "must NOT have more than 2 items",
  });
});

test("invalid-schema/tool-result-meta-mcp-call-block-missing-type.trail.jsonl reports required type at /payload/meta/mcp_call/content_blocks/0/type", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-result-meta-mcp-call-block-missing-type.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/meta/mcp_call/content_blocks/0/type",
    severity: "error",
    code: "required",
    message: "must have required property 'type'",
  });
});

test("reader-tolerant/tool-result-meta-registered-extra-field: strict errors, tolerant warns at nested meta path", async () => {
  const text = await loadFixture(
    "reader-tolerant/tool-result-meta-registered-extra-field.trail.jsonl",
  );

  const strict = await validateTrailString(text);
  expect(strict).toContainEqual({
    line: 3,
    path: "/payload/meta/shell_command/exitcode",
    severity: "error",
    code: "additionalProperties",
    message: "must NOT have additional properties",
  });

  const tolerant = await validateTrailString(text, { profile: "reader-tolerant" });
  expect(tolerant).toContainEqual({
    line: 3,
    path: "/payload/meta/shell_command/exitcode",
    severity: "warning",
    code: "reader_tolerant_unknown_payload_field",
    message: 'Unknown payload field "exitcode" preserved for reader-tolerant parsing',
  });
  expect(tolerant.some((d) => d.severity === "error")).toBe(false);
});

test("valid/unmatched-tool-call-suppressed-by-session-end.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/unmatched-tool-call-suppressed-by-session-end.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/unmatched-tool-call-suppressed-by-session-terminated.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/unmatched-tool-call-suppressed-by-session-terminated.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-call-matched-by-semantic-call-id.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-call-matched-by-semantic-call-id.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-call-matched-sequentially.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-call-matched-sequentially.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/session-end-with-final-message-id.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/session-end-with-final-message-id.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-graph/unmatched-tool-call-at-eof.trail.jsonl warns about unmatched tool_call at EOF", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/unmatched-tool-call-at-eof.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/id",
    severity: "warning",
    code: "unmatched_tool_call_at_eof",
    message:
      'tool_call "01HEVTA0000000000000000001" has no matching tool_result or call-scoped tool_call_aborted at EOF',
  });
});

test("invalid-graph/tool-call-aborted-turn-scope-does-not-close-call.trail.jsonl warns about unmatched tool_call", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/tool-call-aborted-turn-scope-does-not-close-call.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/id",
    severity: "warning",
    code: "unmatched_tool_call_at_eof",
    message:
      'tool_call "01HEVTA0000000000000000001" has no matching tool_result or call-scoped tool_call_aborted at EOF',
  });
});

test("invalid-graph/session-end-unknown-final-message-id.trail.jsonl warns about unknown final_message_id", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/session-end-unknown-final-message-id.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/final_message_id",
    severity: "warning",
    code: "unknown_final_message_id",
    message:
      'session_end final_message_id "01HGH0ST000000000000000001" does not reference the session header or a prior event in this file',
  });
});

test("invalid-graph/unmatched-tool-call-partial-suppression.trail.jsonl warns only for unlisted ids", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/unmatched-tool-call-partial-suppression.trail.jsonl"),
  );
  const unmatched = diagnostics.filter((d) => d.code === "unmatched_tool_call_at_eof");
  expect(unmatched).toEqual([
    {
      line: 3,
      path: "/id",
      severity: "warning",
      code: "unmatched_tool_call_at_eof",
      message:
        'tool_call "01HEVTA0000000000000000002" has no matching tool_result or call-scoped tool_call_aborted at EOF',
    },
  ]);
});

test("invalid-graph/unmatched-tool-call-session-terminated-without-open-call-ids.trail.jsonl still warns", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture(
      "invalid-graph/unmatched-tool-call-session-terminated-without-open-call-ids.trail.jsonl",
    ),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/id",
    severity: "warning",
    code: "unmatched_tool_call_at_eof",
    message:
      'tool_call "01HEVTA0000000000000000001" has no matching tool_result or call-scoped tool_call_aborted at EOF',
  });
});

test("invalid-graph/unmatched-tool-call-at-eof.trail.jsonl warns under reader-tolerant profile", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/unmatched-tool-call-at-eof.trail.jsonl"),
    { profile: "reader-tolerant" },
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/id",
    severity: "warning",
    code: "unmatched_tool_call_at_eof",
    message:
      'tool_call "01HEVTA0000000000000000001" has no matching tool_result or call-scoped tool_call_aborted at EOF',
  });
});

test("invalid-graph/session-end-unknown-final-message-id.trail.jsonl warns under reader-tolerant profile", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/session-end-unknown-final-message-id.trail.jsonl"),
    { profile: "reader-tolerant" },
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/final_message_id",
    severity: "warning",
    code: "unknown_final_message_id",
    message:
      'session_end final_message_id "01HGH0ST000000000000000001" does not reference the session header or a prior event in this file',
  });
});

test("valid/session-end-final-message-id-references-header.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/session-end-final-message-id-references-header.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/tool-result-for-id-targets-header-falls-through.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/tool-result-for-id-targets-header-falls-through.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/multiple-session-end-events.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/multiple-session-end-events.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-graph/tool-result-for-id-wins-over-semantic-conflict.trail.jsonl warns only for the call left unmatched", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/tool-result-for-id-wins-over-semantic-conflict.trail.jsonl"),
  );
  const unmatched = diagnostics.filter((d) => d.code === "unmatched_tool_call_at_eof");
  expect(unmatched).toEqual([
    {
      line: 3,
      path: "/id",
      severity: "warning",
      code: "unmatched_tool_call_at_eof",
      message:
        'tool_call "01HEVTA0000000000000000002" has no matching tool_result or call-scoped tool_call_aborted at EOF',
    },
  ]);
});

test("invalid-schema/session-end-final-message-id-null.trail.jsonl reports schema type error and no graph warning", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/session-end-final-message-id-null.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/final_message_id",
    severity: "error",
    code: "type",
    message: "must be string",
  });
  expect(diagnostics.filter((d) => d.code === "unknown_final_message_id")).toEqual([]);
});

test("invalid-graph/duplicate-tool-result-for-id.trail.jsonl resolved for_id does not fall through to sequential", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/duplicate-tool-result-for-id.trail.jsonl"),
  );
  const unmatched = diagnostics.filter((d) => d.code === "unmatched_tool_call_at_eof");
  expect(unmatched).toEqual([
    {
      line: 3,
      path: "/id",
      severity: "warning",
      code: "unmatched_tool_call_at_eof",
      message:
        'tool_call "01HEVTA0000000000000000002" has no matching tool_result or call-scoped tool_call_aborted at EOF',
    },
  ]);
});

test("invalid-graph/session-end-forward-final-message-id.trail.jsonl warns on forward reference", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/session-end-forward-final-message-id.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/final_message_id",
    severity: "warning",
    code: "unknown_final_message_id",
    message:
      'session_end final_message_id "01HEVTA0000000000000000002" does not reference the session header or a prior event in this file',
  });
});

test("invalid-graph/duplicate-option-labels.trail.jsonl warns for duplicate labels without ids", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/duplicate-option-labels.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/questions/0/options/1/label",
    severity: "warning",
    code: "duplicate_option_labels",
    message:
      'user_query question "ship" has duplicate option label "yes" without stable option ids; user_query_response selected values may be ambiguous',
  });
});

test("invalid-graph/duplicate-option-labels-mixed-ids.trail.jsonl warns when only some duplicates have ids", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/duplicate-option-labels-mixed-ids.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/questions/0/options/1/label",
    severity: "warning",
    code: "duplicate_option_labels",
    message:
      'user_query question "ship" has duplicate option label "yes" without stable option ids; user_query_response selected values may be ambiguous',
  });
});

test("valid/user-query-duplicate-labels-with-ids.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/user-query-duplicate-labels-with-ids.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-graph/header-has-parent-id.trail.jsonl reports additionalProperties + header_has_parent_id", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/header-has-parent-id.trail.jsonl"),
  );
  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/parent_id",
      severity: "error",
      code: "additionalProperties",
      message: "must NOT have additional properties",
    },
    {
      line: 1,
      path: "/parent_id",
      severity: "error",
      code: "header_has_parent_id",
      message: "Session header must not have a parent_id",
    },
  ]);
});

test("hash-mismatch/content-hash-mismatch.trail.jsonl reports content_hash_mismatch (strict error)", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("hash-mismatch/content-hash-mismatch.trail.jsonl"),
  );
  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "content_hash_mismatch",
      message:
        "content_hash does not match canonical bytes (computed 8dbf946e5d4ccd2a4ff2681d2c2fe2614f0769bdfeafe5e4f242db14872db5f7)",
    },
  ]);
});

test("hash-mismatch/content-hash-mismatch.trail.jsonl downgrades to warning under reader-tolerant", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("hash-mismatch/content-hash-mismatch.trail.jsonl"),
    { profile: "reader-tolerant" },
  );
  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/content_hash",
      severity: "warning",
      code: "content_hash_mismatch",
      message:
        "content_hash does not match canonical bytes (computed 8dbf946e5d4ccd2a4ff2681d2c2fe2614f0769bdfeafe5e4f242db14872db5f7)",
    },
  ]);
});

test("hash-mismatch/content-hash-invalid-hex.trail.jsonl reports schema oneOf errors + content_hash_invalid", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("hash-mismatch/content-hash-invalid-hex.trail.jsonl"),
  );
  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "pattern",
      message: 'must match pattern "^[a-f0-9]{64}$"',
    },
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "const",
      message: "must be equal to constant",
    },
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "oneOf",
      message: "must match exactly one schema in oneOf",
    },
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "content_hash_invalid",
      message: "content_hash must be 64 lowercase hex characters",
    },
  ]);
});

test("reader-tolerant/patch-compatible-schema-version: strict errors, tolerant warns", async () => {
  const text = await loadFixture("reader-tolerant/patch-compatible-schema-version.trail.jsonl");

  const strict = await validateTrailString(text);
  expect(strict.some((d) => d.code === "const" && d.path === "/schema_version")).toBe(true);

  const tolerant = await validateTrailString(text, { profile: "reader-tolerant" });
  expect(tolerant).toEqual([
    {
      line: 1,
      path: "/schema_version",
      severity: "warning",
      code: "reader_tolerant_schema_version",
      message: 'schema_version "0.1.1" accepted by reader-tolerant patch compatibility',
    },
  ]);
});

test("reader-tolerant/unknown-payload-field: strict errors, tolerant warns", async () => {
  const text = await loadFixture("reader-tolerant/unknown-payload-field.trail.jsonl");

  const strict = await validateTrailString(text);
  expect(strict).toContainEqual({
    line: 2,
    path: "/payload/future_field",
    severity: "error",
    code: "additionalProperties",
    message: "must NOT have additional properties",
  });

  const tolerant = await validateTrailString(text, { profile: "reader-tolerant" });
  expect(tolerant).toContainEqual({
    line: 2,
    path: "/payload/future_field",
    severity: "warning",
    code: "reader_tolerant_unknown_payload_field",
    message: 'Unknown payload field "future_field" preserved for reader-tolerant parsing',
  });
  expect(tolerant.some((d) => d.severity === "error")).toBe(false);
});

test("reader-tolerant/ill-formed-string: strict errors, tolerant warns", async () => {
  const text = await loadFixture("reader-tolerant/ill-formed-string.trail.jsonl");

  const strict = await validateTrailString(text);
  expect(strict).toContainEqual({
    line: 2,
    path: "/payload/text",
    severity: "error",
    code: "ill_formed_string",
    message: "String contains an unpaired surrogate; writers must replace it with U+FFFD",
  });

  const tolerant = await validateTrailString(text, { profile: "reader-tolerant" });
  expect(tolerant).toEqual([
    {
      line: 2,
      path: "/payload/text",
      severity: "warning",
      code: "ill_formed_string",
      message: "String contains an unpaired surrogate; writers must replace it with U+FFFD",
    },
  ]);
});

test("reader-tolerant/nested-unknown-payload-field warns at nested path", async () => {
  const tolerant = await validateTrailString(
    await loadFixture("reader-tolerant/nested-unknown-payload-field.trail.jsonl"),
    { profile: "reader-tolerant" },
  );
  expect(tolerant).toEqual([
    {
      line: 2,
      path: "/payload/attachments/0/future_field",
      severity: "warning",
      code: "reader_tolerant_unknown_payload_field",
      message: 'Unknown payload field "future_field" preserved for reader-tolerant parsing',
    },
  ]);
});

test("reader-tolerant/capability-change-unknown-payload-field warns at capability payload path", async () => {
  const tolerant = await validateTrailString(
    await loadFixture("reader-tolerant/capability-change-unknown-payload-field.trail.jsonl"),
    { profile: "reader-tolerant" },
  );
  expect(tolerant).toEqual([
    {
      line: 2,
      path: "/payload/future_field",
      severity: "warning",
      code: "reader_tolerant_unknown_payload_field",
      message: 'Unknown payload field "future_field" preserved for reader-tolerant parsing',
    },
  ]);
});

test("reader-tolerant/unknown-event-type preserves unknown record with warning", async () => {
  const strict = await validateTrailString(
    await loadFixture("reader-tolerant/unknown-event-type.trail.jsonl"),
  );
  expect(strict).toContainEqual({
    line: 2,
    path: "",
    severity: "error",
    code: "oneOf",
    message: "must match exactly one schema in oneOf",
  });

  const tolerant = await validateTrailString(
    await loadFixture("reader-tolerant/unknown-event-type.trail.jsonl"),
    { profile: "reader-tolerant" },
  );
  expect(tolerant).toEqual([
    {
      line: 2,
      path: "/type",
      severity: "warning",
      code: "reader_tolerant_unknown_record",
      message: 'Unknown event type "future_event" preserved for reader-tolerant parsing',
    },
  ]);
});

test("reader-tolerant/reserved-future-event-type preserves reserved type with warning", async () => {
  const tolerant = await validateTrailString(
    await loadFixture("reader-tolerant/reserved-future-event-type.trail.jsonl"),
    { profile: "reader-tolerant" },
  );
  expect(tolerant).toEqual([
    {
      line: 2,
      path: "/type",
      severity: "warning",
      code: "reader_tolerant_unknown_record",
      message: 'Unknown event type "error" preserved for reader-tolerant parsing',
    },
  ]);
});

test("valid/with-trail-envelope.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/with-trail-envelope.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/with-trail-envelope-and-hash.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/with-trail-envelope-and-hash.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-schema/envelope-missing-producer.trail.jsonl reports required /producer", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/envelope-missing-producer.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/producer",
    severity: "error",
    code: "required",
    message: "must have required property 'producer'",
  });
});

test("invalid-graph/envelope-not-at-line-1.trail.jsonl reports envelope_not_at_line_1", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/envelope-not-at-line-1.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/type",
    severity: "error",
    code: "envelope_not_at_line_1",
    message: "Trail envelope MUST appear at line 1; found at a later line",
  });
});

test("invalid-graph/multiple-envelopes.trail.jsonl reports multiple_envelopes", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/multiple-envelopes.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/type",
    severity: "error",
    code: "multiple_envelopes",
    message: "Trail envelope MUST appear at most once per file",
  });
});

test("invalid-graph/envelope-without-session-header.trail.jsonl reports missing_header_after_envelope", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/envelope-without-session-header.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "",
    severity: "error",
    code: "missing_header_after_envelope",
    message:
      'Trail envelope at line 1 MUST be followed by a session header on line 2 with type "session" and schema_version "0.1.0"',
  });
});

test("hash-mismatch/trail-envelope-content-hash-mismatch.trail.jsonl reports envelope mismatch", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("hash-mismatch/trail-envelope-content-hash-mismatch.trail.jsonl"),
  );
  expect(diagnostics.some((d) => d.line === 1 && d.code === "content_hash_mismatch")).toBe(true);
});

test("valid/with-trail-envelope-all-fields.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/with-trail-envelope-all-fields.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-graph/envelope-sessions-manifest-empty.trail.jsonl warns envelope_sessions_manifest_drift", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/envelope-sessions-manifest-empty.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/sessions",
    severity: "warning",
    code: "envelope_sessions_manifest_drift",
    message: "envelope.sessions lists 0 session(s); file contains 1",
  });
});

test("invalid-graph/envelope-sessions-manifest-multiple.trail.jsonl warns envelope_sessions_manifest_drift", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/envelope-sessions-manifest-multiple.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/sessions",
    severity: "warning",
    code: "envelope_sessions_manifest_drift",
    message: "envelope.sessions lists 2 session(s); file contains 1",
  });
});

test("valid/multi-session-two-no-envelope.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/multi-session-two-no-envelope.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/multi-session-with-envelope.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/multi-session-with-envelope.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/multi-session-fork-from-chain.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/multi-session-fork-from-chain.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-graph/multi-session-orphan-prelude.trail.jsonl reports events_before_first_session_header", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/multi-session-orphan-prelude.trail.jsonl"),
  );
  expect(
    diagnostics.some(
      (d) => d.severity === "error" && d.code === "events_before_first_session_header",
    ),
  ).toBe(true);
});

test("invalid-graph/multi-session-cross-group-parent.trail.jsonl reports unknown_parent_id", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/multi-session-cross-group-parent.trail.jsonl"),
  );
  expect(diagnostics.some((d) => d.severity === "error" && d.code === "unknown_parent_id")).toBe(
    true,
  );
});

test("valid/multi-segment-seg1.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/multi-segment-seg1.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/multi-segment-seg2.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/multi-segment-seg2.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-schema/segment-seq-2-without-prev-hash.trail.jsonl rejects missing prev_content_hash", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/segment-seq-2-without-prev-hash.trail.jsonl"),
  );
  expect(diagnostics.some((d) => d.severity === "error" && d.path === "/segment")).toBe(true);
});

test("invalid-schema/session-uid-not-ulid-or-uuid.trail.jsonl rejects non-conforming session_uid", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/session-uid-not-ulid-or-uuid.trail.jsonl"),
  );
  expect(
    diagnostics.some(
      (d) => d.severity === "error" && d.path === "/session_uid" && d.code === "pattern",
    ),
  ).toBe(true);
});

test("invalid-schema/segment-seq-zero.trail.jsonl rejects seq < 1", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/segment-seq-zero.trail.jsonl"),
  );
  expect(diagnostics.some((d) => d.severity === "error" && d.path === "/segment")).toBe(true);
});

test("invalid-schema/segment-seq-1-with-prev-hash.trail.jsonl rejects seq=1 with prev_content_hash", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/segment-seq-1-with-prev-hash.trail.jsonl"),
  );
  expect(diagnostics.some((d) => d.severity === "error" && d.path === "/segment")).toBe(true);
});

test("invalid-schema/segment-seq-2-without-session-uid.trail.jsonl rejects missing session_uid", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/segment-seq-2-without-session-uid.trail.jsonl"),
  );
  expect(
    diagnostics.some(
      (d) => d.severity === "error" && d.code === "required" && d.path === "/session_uid",
    ),
  ).toBe(true);
});
