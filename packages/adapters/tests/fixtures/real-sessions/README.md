# Real Session Fixtures

These fixtures are manually redacted source-agent session fixtures plus expected Agent Trail output.
JSONL-native agents use redacted source JSONL directly. Storage-tree agents may use a redacted
flattened JSONL fixture whose records materialize the source files in tests.

The source fixtures preserve real source schema shapes but redact local paths, user identity, repository identity, secrets, free-text transcript content, and opaque encrypted reasoning blobs.
Literal source metadata such as event types, safe enum values, model ids, and tool or schema field names may remain when they do not identify a person, local machine, private repository, or transcript text.

Each `*.source.jsonl` file is parsed by its adapter, materialized first when needed, and compared
to the matching `*.trail.jsonl` golden output.

Do not regenerate source fixtures from local raw sessions. Add or update these files only after manual redaction, then regenerate the matching golden trail from the redacted source file.
