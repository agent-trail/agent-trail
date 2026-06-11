# Blob transport for shared trails

## Decision

Blob-capable transport should use an archive bundle that contains one canonical
trail JSONL file plus content-addressed blob entries. The trail file remains the
format contract. Blob bytes are transported beside it, not inside it.

The existing reference shape stays unchanged:

- Attachments use `attachments[].uri: "sha256:<64 lowercase hex>"` when the
  blob is content-addressed.
- Truncated tool arguments and results use
  `overflow_ref: "sha256:<64 lowercase hex>"`.
- Trail `content_hash` continues to cover only the canonical trail JSONL bytes
  (or the decompressed canonical JSONL bytes for `.trail.jsonl.gz`). It never
  covers blob bytes.

The bundle format, extension, MIME type, manifest shape, CLI commands, and
viewer behavior are follow-up implementation decisions. They must use a distinct
name from `.trail.jsonl` and `.trail.jsonl.gz`; those suffixes remain trail-only
artifacts.

## Considered Options

- Sidecar directory convention (`<trail>.assets/` keyed by content hash):
  useful as an unpacked local representation, but weak for sharing because it is
  not atomic and is easy to separate from the trail file.
- Archive bundle containing the trail and blobs: chosen. It is portable,
  atomic, works offline, and keeps the trail byte stream stable.
- Size-capped base64 inline payloads: rejected for v0.1.0. The spec explicitly
  defers inline `data:` attachment payloads, and large inline blobs would make
  JSONL streaming and review worse.
- Content-addressed store references resolved by the viewer: deferred. It needs
  hosted blob storage, a resolver, or a public index, which is out of scope for
  v1 sharing and for this issue.

## Boundaries

`.trail.jsonl.gz` is a whole-file gzip wrapper around one trail file. It must
not carry sidecar blobs, bundle manifest data, or multiple archive members.
Native gzip support exists so tools can validate and register compressed trail
files while still hashing and storing canonical uncompressed trail JSONL bytes.

V1 gist sharing remains trail-only:

- `trail share` uploads a base64-encoded, gzip-wrapped trail JSONL payload to an
  unlisted gist.
- `content_hash` verifies the decompressed canonical JSONL bytes.
- Blob bytes are not uploaded to the gist.
- `sha256:` attachment and overflow references whose blob bytes are absent must
  render as unresolved references.
- Local `file:` attachment URIs are rewritten to `sha256:` only when the
  referenced blob is content-addressed and transported with a blob-capable
  share; otherwise redaction removes `uri` and preserves visible stub metadata
  such as `kind`, `name`, and `media_type`.

## Consequences

- No immediate `schema.json` change is required.
- No `content_hash` semantics change is allowed.
- Blob bytes are redaction surface. Screenshots, pasted images, oversized tool
  arguments, and oversized tool results must be stripped by default unless the
  blob can be redacted or the user explicitly consents to pass it through.
- Future implementation issues should cover bundle round-trip, blob inventory
  collection, missing-blob display, blob hash mismatch rejection, redaction
  strip/pass-through behavior, decompression and archive-size limits, and tests
  proving `.trail.jsonl.gz` is not treated as a bundle.

Closes #262.
