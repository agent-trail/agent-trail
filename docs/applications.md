# Potential applications of Agent Trail

This document is **non-normative**. It illustrates the kinds of tools and workflows that can be built on top of the Agent Trail format. The format itself defines none of these; they are intended as orientation for adopters considering whether Agent Trail fits their use case.

The canonical format contract lives in [`spec.md`](../spec.md) and [`schema.json`](../schema.json). This file is companion documentation and may evolve independently of the spec version.

## Sharing & collaboration

1. **Cross-agent sharing** — one share command produces an artifact that any compliant viewer renders, regardless of which agent produced the session.
2. **Agent-to-agent handoff** — a skill packs a curated subset of the current session into a portable artifact (markdown primer or JSONL trail) so a different agent can continue the work.
3. **Pull-request review integration** — a GitHub Action surfaces a session digest as a PR comment when the PR description references a trail, giving reviewers visibility into the AI-assisted work behind the change.

## Search & recall

4. **Cross-tool text search** — grep over a local trail store regardless of which agent produced each session, since every trail uses the same canonical event vocabulary.
5. **Semantic search** — a skill (using the user's chosen embedding API) indexes local trails and answers "find sessions where I debugged race conditions" without bundling a vector store.
6. **Causality graph queries** — follow `fork_from` and `derived_from` chains across the local store to answer "show me all sessions that descend from this one."

## Analysis & diagnostics

7. **Deterministic statistics** — counts and distributions over events, tool kinds, durations, success rates, and file touch sets, all derivable from the canonical schema without semantic interpretation.
8. **Pattern findings** — pre-defined mechanical checks for stuck loops, error storms, unmatched tool calls, oversized outputs, and other quality signals visible from event sequences.
9. **Cost and token analytics** — per-model pricing applied to token usage captured by adapters. Token usage is recorded on `agent_message.payload.usage` (spec §9.2); vendor-specific cost extensions can live under entry `meta` with reverse-domain keys (e.g., `io.anthropic.usage`). Either source enables cache-utilization tracking and cross-tool comparison for the same task.

## Quality & regression

10. **Tool-call replay** — re-run historical `tool_call` events against a new tool implementation and diff outputs against recorded `tool_result` payloads, turning trails into regression-test corpora.
11. **Cross-agent benchmarking** — same task captured under multiple agents, then compared via pairwise diff to surface differences in approach, cost, and success rate.

## Knowledge capture & reuse

12. **Session summarisation** — a skill reads any trail file and emits a focused summary in the calling agent's context using the user's own model, with no LLM dependency in Agent Trail's toolchain.
13. **Prompt distillation** — a skill converts a trail file into a reusable system prompt or skill scaffold, extracting the lessons learned through a long session into a concise reusable form.
14. **Documentation generation** — turn a debugging session into a runbook or post-mortem document by walking the canonical event sequence.
15. **Portable user profile** — a skill aggregates patterns across many sessions and many agents into a `PROFILE.md` artifact (communication style, working preferences, domain context, common workflows, anti-patterns, preferred tools). Users reference the file from any agent so new sessions cold-start with a coherent picture of the user.

## Personalization & coaching

16. **Prompt-improvement coaching** — downstream apps watch a user's session corpus and PROFILE.md evolution over time, surface where prompting habits could improve, and suggest skill templates to install. Built on the profile skill (#15) and analyze package; Agent Trail provides substrate, not the app.

## Editor & ecosystem integration

17. **Native editor viewer** — a VS Code extension renders `.trail.jsonl` files with a timeline UI, jump-to-source for `file_read` paths, and inline diff rendering for `file_edit` events, sharing a renderer with the web viewer.
18. **MCP server** — exposes local sessions to coding agents via Model Context Protocol so agents can list, search, load, and share trails without leaving their UI.
19. **Code-attribution interop** — formats such as Agent Trace can use a trail file as the target of their `conversation.url` field, linking attribution records in source repos to the sessions that produced them.

## Audit, compliance & research

20. **Tamper-evident artifacts** — finalized trail files carry a `content_hash` over canonical bytes, so any modification produces a different hash and can be detected by re-verification.
21. **Provenance chains** — `redacted_from` and `derived_from` header fields record artifact lineage end to end, enabling consumers to trace a shared artifact back to its raw source.
22. **OSS transparency** — projects that commit trail files alongside source code document AI-assisted contributions in a machine-readable, reviewer-friendly form.
23. **Research artifacts** — academic studies of AI-assisted coding can publish anonymized trail files for reproducibility, with content hashes guaranteeing artifact identity across runs.
24. **Compliance audit trail** — regulated industries can capture session history with content-addressed identity, supporting audits without committing to a vendor's proprietary format.
