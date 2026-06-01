import {
  type CheckMessage,
  cleanupWorktrees,
  doctorWorktreeWorkflow,
  setupWorktreeWorkflow,
  syncMain,
} from "./worktree-workflow-lib.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function printMessages(messages: CheckMessage[]): void {
  for (const message of messages) {
    const prefix = message.level === "ok" ? "ok" : message.level;
    console.log(`${prefix}: ${message.message}`);
  }
}

function usage(): never {
  console.error(`Usage: bun run scripts/worktree-workflow.ts <setup|doctor|cleanup|sync-main> [options]

Commands:
  setup                 Repair current worktree Git config.
  doctor                Validate worktree Git config and stale worktree state.
  cleanup [--apply]     Remove clean merged/closed PR worktrees; dry-run by default.
  sync-main [--discard-local-changes]
                        Fetch/prune origin and update local main safely.
`);
  process.exit(2);
}

const command = process.argv[2];

if (command === "setup") {
  const messages = await setupWorktreeWorkflow();
  printMessages(messages);
  process.exit(messages.some((message) => message.level === "error") ? 1 : 0);
}

if (command === "doctor") {
  const result = await doctorWorktreeWorkflow();
  printMessages(result.messages);
  process.exit(result.ok ? 0 : 1);
}

if (command === "cleanup") {
  const apply = hasFlag("--apply");
  const result = await cleanupWorktrees(process.cwd(), { apply });
  for (const action of result.actions) {
    const target = action.path === undefined ? "" : ` ${action.path}`;
    const branch = action.branch === undefined ? "" : ` (${action.branch})`;
    console.log(
      `${apply ? "apply" : "dry-run"}: ${action.action}${target}${branch}: ${action.reason}`,
    );
  }
  process.exit(0);
}

if (command === "sync-main") {
  const messages = await syncMain(process.cwd(), {
    discardLocalChanges: hasFlag("--discard-local-changes"),
  });
  printMessages(messages);
  process.exit(messages.some((message) => message.level === "error") ? 1 : 0);
}

usage();
