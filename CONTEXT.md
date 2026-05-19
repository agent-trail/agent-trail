# Agent Trail

Agent Trail defines the shared language for portable coding-agent session interchange. This glossary keeps product, spec, and implementation discussions aligned without turning the glossary into a specification.

## Language

**Agent Trail**:
The open format and tooling ecosystem for portable coding-agent sessions.
_Avoid_: AgentTrail, Trail product

**Trail file**:
A JSONL artifact that represents one coding-agent session in the Agent Trail format.
_Avoid_: Session dump, transcript file, conversation export

**Format contract**:
The stable interoperability agreement that compliant writers and readers rely on.
_Avoid_: TypeScript API, implementation model

**JSON Schema**:
The canonical machine-readable contract for validating Agent Trail records.
_Avoid_: Generated type source, helper schema

**Writer-strict validation**:
Validation that proves an emitted trail file conforms exactly to a released schema and whole-file rules.
_Avoid_: Normal validation, loose validation

**Reader-tolerant parsing**:
Parsing that preserves or skips unfamiliar future data without treating every unknown shape as fatal.
_Avoid_: Strict validation, schema validation

**Raw trail**:
A local trail artifact that preserves source-session fidelity before sharing.
_Avoid_: Original trail, private copy

**Redacted trail**:
A separate trail artifact produced from a raw trail with sensitive content removed or normalized.
_Avoid_: Sanitized view, safe mode

**Shared trail**:
A redacted trail transported through a sharing mechanism.
_Avoid_: Public trail, hosted session

**Adapter**:
Software that converts a source agent's session storage into a trail file.
_Avoid_: Importer, parser plugin

**Parser Source Matrix**:
The living record of adapter source formats, verification dates, and fixture coverage.
_Avoid_: Adapter docs, compatibility list

## Relationships

- A **Trail file** conforms to the **Format contract**.
- The **JSON Schema** is the canonical machine-readable part of the **Format contract**.
- **Writer-strict validation** checks emitted **Trail files** before publication or storage.
- **Reader-tolerant parsing** is for consumers reading potentially newer **Trail files**.
- An **Adapter** emits a **Raw trail** from a source agent session.
- A **Redacted trail** is produced from a **Raw trail**.
- A **Shared trail** transports a **Redacted trail**.
- The **Parser Source Matrix** records the evidence behind each **Adapter**.

## Example dialogue

> **Dev:** "Should the TypeScript type definitions become the source of truth for the format?"
> **Domain expert:** "No. The **JSON Schema** is the canonical **Format contract**; generated TypeScript types are implementation artifacts."

## Flagged ambiguities

- "Validation" can mean **Writer-strict validation** or **Reader-tolerant parsing**. Resolved: use the precise term when behavior matters.
- "Trail" can mean a raw, redacted, or shared artifact. Resolved: use **Raw trail**, **Redacted trail**, or **Shared trail** when artifact identity matters.
