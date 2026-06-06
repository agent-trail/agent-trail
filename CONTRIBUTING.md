# Contributing to Agent Trail

Agent Trail is an open format and tooling ecosystem for portable coding-agent
session interchange. Contributions are welcome while the v0.1 format is still a
working draft.

## Contribution paths

Use the smallest path that fits the change:

- **Bug reports**: use the bug issue template for reproducible defects.
- **Tasks or features**: use the task issue template for scoped implementation,
  adapter, CLI, test, or documentation work.
- **RFC / spec decisions**: use the RFC issue template before changing
  load-bearing format or architecture shape.
- **Pull requests**: link the issue, keep the slice narrow, and include the
  strongest relevant verification.

Keep secrets, real local session data, private logs, and unredacted trail files
out of public issues and pull requests. For vulnerabilities, use the private
GitHub security advisory link from the issue chooser instead of opening a public
issue.

## Spec lifecycle

The current `spec.md` is the v0.1 working draft. RFC issues are the public review
path for proposed load-bearing changes before implementation.

Agent Trail uses this lightweight lifecycle:

1. **Working Draft**: current root `spec.md` and `schema.json` describe the next
   format target.
2. **Proposed RFC**: an issue proposes a load-bearing change, with problem,
   affected surface, proposal, alternatives, compatibility risk, and verification
   impact.
3. **Accepted**: maintainers agree on the rule or direction. Durable architecture
   decisions may also need an ADR.
4. **Implemented**: pull requests update the relevant spec, schema, docs, tests,
   fixtures, generated artifacts, and reference implementation code.
5. **Published**: released spec and schema snapshots are immutable, such as
   `/spec/v0.1.0` and `/schema/v0.1.0.json`.
6. **Superseded / Withdrawn**: later decisions replace, retire, or abandon an
   earlier proposal or published behavior.

## When an RFC is required

Open an RFC issue before changing load-bearing shape, including:

- normative format or schema semantics
- validation terminology or behavior
- versioning or compatibility policy
- content hash, artifact identity, raw/redacted/shared trail semantics
- public URL shape
- package layout or ownership boundaries
- durable architecture decisions

An RFC is not required for ordinary implementation work, including:

- adapter fixes or new source-agent mappings that fit the existing format
- CLI behavior that does not alter the format contract
- tests, fixtures, or docs that clarify existing behavior
- editorial spec fixes that do not change validity, semantics, or compatibility
- internal refactors that preserve public behavior

When unsure, open the RFC issue. The issue can close as "no RFC needed" if the
change is narrower than expected.

## Repository rules

- `schema.json` is the canonical writer-strict machine-readable format contract.
- Generated TypeScript types derive from `schema.json`; do not make TypeScript
  the format source of truth.
- After editing root `schema.json`, run `bun run sync:schema` and
  `bun run generate:types`, then commit the generated diffs.
- Committed fixtures must be synthetic or redacted. Real local sessions stay out
  of git and belong only in opt-in ignored tests.
- Do not include Claude, Codex, or other agent attribution in commits, PR bodies,
  generated docs, or code comments.
- Keep root contract files visible: `spec.md` and `schema.json` stay at the repo
  root.

Use the project glossary in `CONTEXT.md` for names such as **Trail file**,
**Raw trail**, **Redacted trail**, **Shared trail**, **Writer-strict
validation**, and **Reader-tolerant parsing**.

## Development workflow

Work in a feature branch or feature branch worktree, not directly on `main`.
Follow `docs/worktree-workflow.md` for this repo's worktree rules.

Start and end implementation work with:

```bash
bun run worktree:doctor
```

Use the strongest relevant check for the change:

```bash
bun run check
```

For narrower changes, use the targeted scripts listed in `package.json`, such as
`bun run typecheck`, `bun run lint`, `bun run test`, `bun run check:schema`, or
`bun run check:types`.

## Pull requests

- Keep each PR tied to one issue or one small decision.
- Use a Conventional Commit PR title; the PR title becomes the squash commit
  subject.
- If a PR changes load-bearing format or architecture shape, link the accepted
  RFC issue.
- Mark public impact in the PR template.
- Include verification commands and results.
