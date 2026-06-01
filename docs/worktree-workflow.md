# Worktree Workflow

This repo uses `main` as a clean launchpad. Implementation work should happen in a
dedicated feature branch worktree, including Codex-managed worktrees under
`~/.codex/worktrees/`.

## Rules

- Keep the primary `main` worktree clean and synced with `origin/main`.
- Use one branch worktree per issue or PR.
- Run `bun run worktree:doctor` at the start and end of work.
- Run `bun run worktree:cleanup -- --apply` after a PR is merged or closed.
- Do not run `lefthook install` manually in worktrees.

## Commands

```bash
bun run worktree:setup
bun run worktree:doctor
bun run worktree:sync-main
bun run worktree:sync-main -- --discard-local-changes
bun run worktree:cleanup
bun run worktree:cleanup -- --apply
```

`worktree:setup` configures the current worktree for this repo:

- `core.bare=false`
- `extensions.worktreeConfig=true`
- per-worktree `core.hooksPath=.githooks`

`worktree:doctor` fails on hard Git state problems and warns on suspicious state,
including shared hook scripts containing absolute managed-worktree paths.

`worktree:cleanup` is dry-run by default. With `--apply`, it removes only clean
linked worktrees whose branch has a merged or closed PR, then prunes stale origin
refs. Open PR worktrees are never removed.

`worktree:sync-main` fetches and prunes `origin`, then updates local `main` to
`origin/main`. If `main` has local changes, it refuses unless
`--discard-local-changes` is passed.

## Hooks

Git hooks live in tracked `.githooks/` wrappers and delegate to Lefthook at run
time:

- `.githooks/pre-commit`
- `.githooks/pre-push`

This avoids shared `.git/hooks` scripts with absolute paths into a temporary
worktree. `bun install` must not install shared hooks directly; use
`bun run worktree:setup`.
