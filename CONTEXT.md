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

**Local store**:
The on-disk home for trail artifacts a user has chosen to keep, rooted by default at `~/.local/share/trail/`. Holds finalized objects and a rebuildable index.
_Avoid_: Cache, database, archive

**Finalized object**:
A canonical trail file with a verified `content_hash`, stored at `objects/sha256/<hash>.trail.jsonl` under the local store.
_Avoid_: Stored trail, persisted artifact

**Index**:
Mutable metadata at `index/objects.json` under the local store. Records `registered_at` and `source_path` per finalized object. Can be rebuilt from the objects directory.
_Avoid_: Database, cache

**Pending hash**:
A header `content_hash` value of `"<pending>"` or omitted; signals an in-progress or streaming trail file that is not eligible to become a finalized object.
_Avoid_: Missing hash, draft hash

**Trail envelope**:
Optional `type:"trail"` record at line 1 of a trail file carrying file-level metadata (producer, file label, file-scope hash, sessions manifest, vendor extensions). Not part of the event graph.
_Avoid_: File header, outer header

**Session-level content hash**:
SHA-256 of the canonical bytes covering only the session header and its events. Independent of whether a trail envelope wraps the file.
_Avoid_: Trail hash, file hash

**File-level content hash**:
SHA-256 of the canonical bytes covering the whole file with the trail envelope's `content_hash` pinned to `<pending>`. Lives on the envelope.
_Avoid_: Session hash, transport hash

**Sessions manifest**:
Optional envelope field `sessions` declaring the sessions present in a trail file. The session header in the file is authoritative; the validator warns on drift.
_Avoid_: Session index, session list

## Relationships

- A **Trail file** conforms to the **Format contract**.
- The **JSON Schema** is the canonical machine-readable part of the **Format contract**.
- **Writer-strict validation** checks emitted **Trail files** before publication or storage.
- **Reader-tolerant parsing** is for consumers reading potentially newer **Trail files**.
- An **Adapter** emits a **Raw trail** from a source agent session.
- A **Redacted trail** is produced from a **Raw trail**.
- A **Shared trail** transports a **Redacted trail**.
- The **Parser Source Matrix** records the evidence behind each **Adapter**.
- A **Finalized object** lives in the **Local store**; the **Index** points at it by `content_hash`.
- A **Pending hash** keeps a trail file out of the **Local store** as a **Finalized object**.

## Example dialogue

> **Dev:** "Should the TypeScript type definitions become the source of truth for the format?"
> **Domain expert:** "No. The **JSON Schema** is the canonical **Format contract**; generated TypeScript types are implementation artifacts."

## Flagged ambiguities

- "Validation" can mean **Writer-strict validation** or **Reader-tolerant parsing**. Resolved: use the precise term when behavior matters.
- "Trail" can mean a raw, redacted, or shared artifact. Resolved: use **Raw trail**, **Redacted trail**, or **Shared trail** when artifact identity matters.
