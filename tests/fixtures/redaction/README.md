# Redaction fixtures

Synthetic trail inputs (`*.in.jsonl`) exercising the deterministic primitives in `@agent-trail/redact`. The "secrets" here are public dummy values from documentation (`AKIAIOSFODNN7EXAMPLE`, fabricated `sk-proj-…` strings, etc.); no real credentials are committed. The redactor's expected behavior is asserted in `packages/redact/src/fixtures.test.ts`.

| Input | What it demonstrates |
|---|---|
| `clean` | Trail without secrets; redactor returns inputs unchanged. |
| `openai-key` | OpenAI key inside `agent_message.payload.text`. |
| `aws-key` | AWS access key ID in tool output. |
| `pii` | Email + phone + SSN routed through `@redactpii/node`. |
| `source-raw-secret` | OpenAI key buried inside `source.metadata.raw`. |
| `home-paths` | `cwd` and message text normalized to `<home>`. |
| `large-output` | `tool_result.output` truncated past `outputMaxBytes` per spec §14. |
