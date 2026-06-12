# Enum extensibility policy

## Status

Accepted.

## Decision

Agent Trail keeps structural discriminators closed and descriptive state
vocabulary extensible.

Structural discriminators gate parser or renderer dispatch and require a format
version bump for new values. In the current v0.1.0 schema, this includes event
`type`, task-plan delta `kind`, attachment `kind`, and `taskPlanStatus`.

Descriptive state vocabulary accepts reserved values plus vendor-namespaced
extensions of the form `x-<vendor>/<name>`. Bare unknown strings remain
writer-strict errors. Readers treat unknown `x-*` values as opaque strings and
pass them through.

Current extensible vocabulary includes `scope`, `reason`, `trigger`, `origin`,
`command_invoke.kind`, `command_invoke.via`, and `command_invoke.result_action`
slots that describe observed runtime state rather than dispatch shape. It also
includes established extension surfaces such as `system_event.kind`, `vcs.type`,
`session_metadata_update.field`, and custom `agent.name`.

An `x-*` value observed across two or more adapters can be promoted into the
reserved enum in a minor format bump. This follows the convention already stated
for `system_event.kind` in spec section 10.3.

`parse_fidelity.termination_reason` and `session_terminated.reason` both refer
to `$defs.sessionTerminationReason`. They open or close together by construction;
keep the shared definition rather than duplicating the enum.

## Rationale

Closed enums are useful where a new value changes dispatch semantics, rendering
shape, graph validation, or cross-record invariants. They are too expensive for
adapter-specific state vocabulary, because every source-specific reason,
trigger, scope, or invocation channel would otherwise need a schema revision and
minor format bump before a writer could preserve it.

The `x-<vendor>/<name>` grammar already works for `system_event.kind` and
`vcs.type`: reserved values stay portable, while vendor variance remains
namespaced and machine-recognizable. Applying the same rule to descriptive
state vocabulary keeps writer-strict validation strict without forcing lossy
normalization.

## Consequences

- Schema changes that add new structural discriminator values require a format
  version bump.
- Schema changes that add reserved descriptive enum values can land in a minor
  format bump after adapter evidence shows cross-agent use.
- Writers must use `x-<vendor>/<name>` for non-reserved descriptive values and
  must not emit bare unknown strings.
- Readers should not fail only because an otherwise valid descriptive enum uses
  an unknown `x-*` value.
- Future schema edits should keep shared definitions shared when two fields are
  intentionally coupled, as with `$defs.sessionTerminationReason`.

Tracks #289.
