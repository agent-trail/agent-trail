import { access, chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export type CheckLevel = "ok" | "warn" | "error";

export interface CheckMessage {
  level: CheckLevel;
  message: string;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface WorktreeEntry {
  path: string;
  branch?: string;
  head?: string;
  bare?: boolean;
  detached?: boolean;
  prunable?: boolean;
}

export interface PrStatus {
  branch: string;
  state: "OPEN" | "MERGED" | "CLOSED" | "UNKNOWN";
  number?: number;
  mergeStateStatus?: string;
  url?: string;
}

export interface DoctorOptions {
  checkRemote?: boolean;
  resolvePr?: (branch: string, cwd: string) => Promise<PrStatus | undefined>;
}

export interface DoctorResult {
  ok: boolean;
  messages: CheckMessage[];
}

export interface CleanupOptions {
  apply?: boolean;
  prune?: boolean;
  resolvePr?: (branch: string, cwd: string) => Promise<PrStatus | undefined>;
}

export interface CleanupAction {
  action: "remove-worktree" | "skip" | "prune-origin";
  path?: string;
  branch?: string;
  reason: string;
}

export interface CleanupResult {
  applied: boolean;
  actions: CleanupAction[];
}

export interface SyncMainOptions {
  discardLocalChanges?: boolean;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly result: CommandResult,
  ) {
    super(message);
  }
}

const GIT_ENV_KEYS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_QUARANTINE_PATH",
  "GIT_WORK_TREE",
] as const;

function commandEnv(overrides?: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const key of GIT_ENV_KEYS) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; allowFailure?: boolean; env?: Record<string, string | undefined> },
): Promise<CommandResult> {
  const proc = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: commandEnv(options.env),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const result = { code, stdout, stderr };
  if (code !== 0 && options.allowFailure !== true) {
    throw new CommandError(`${command} ${args.join(" ")} failed`, result);
  }
  return result;
}

export function git(cwd: string, args: string[], allowFailure = false): Promise<CommandResult> {
  return runCommand("git", ["-C", cwd, ...args], { cwd, allowFailure });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function executable(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

async function resolveGitDir(cwd: string): Promise<string | undefined> {
  const result = await git(cwd, ["rev-parse", "--git-dir"], true);
  if (result.code === 0) {
    const value = result.stdout.trim();
    return isAbsolute(value) ? value : resolve(cwd, value);
  }

  const dotGit = join(cwd, ".git");
  if (!(await pathExists(dotGit))) {
    return undefined;
  }
  const info = await stat(dotGit);
  if (info.isDirectory()) {
    return dotGit;
  }
  const content = await readFile(dotGit, "utf8");
  const match = /^gitdir:\s*(.+)\s*$/m.exec(content);
  if (match === null) {
    return undefined;
  }
  const value = match[1] ?? "";
  return isAbsolute(value) ? value : resolve(cwd, value);
}

export async function repoRoot(cwd: string): Promise<string> {
  const result = await git(cwd, ["rev-parse", "--show-toplevel"], true);
  if (result.code === 0) {
    return result.stdout.trim();
  }
  const gitDir = await resolveGitDir(cwd);
  if (gitDir !== undefined && basename(gitDir) === ".git") {
    return dirname(gitDir);
  }
  throw new Error(`Could not resolve Git worktree root from ${cwd}`);
}

export async function setupWorktreeWorkflow(cwd = process.cwd()): Promise<CheckMessage[]> {
  const messages: CheckMessage[] = [];
  const gitDir = await resolveGitDir(cwd);
  if (gitDir === undefined) {
    return [{ level: "error", message: "No Git directory found." }];
  }

  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"], true);
  if (inside.stdout.trim() !== "true") {
    await runCommand("git", ["--git-dir", gitDir, "config", "core.bare", "false"], { cwd });
    messages.push({ level: "ok", message: "Set core.bare=false using resolved Git directory." });
  } else {
    await git(cwd, ["config", "core.bare", "false"]);
    messages.push({ level: "ok", message: "Set core.bare=false." });
  }

  const root = await repoRoot(cwd);
  await git(root, ["config", "extensions.worktreeConfig", "true"]);
  await git(root, ["config", "--worktree", "core.hooksPath", ".githooks"]);

  for (const hook of ["pre-commit", "pre-push"]) {
    const hookPath = join(root, ".githooks", hook);
    if (await pathExists(hookPath)) {
      await chmod(hookPath, 0o755);
    }
  }

  messages.push({ level: "ok", message: "Set extensions.worktreeConfig=true." });
  messages.push({ level: "ok", message: "Set per-worktree core.hooksPath=.githooks." });
  return messages;
}

export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "") {
      if (current !== undefined) {
        entries.push(current);
        current = undefined;
      }
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") {
      if (current !== undefined) {
        entries.push(current);
      }
      current = { path: value };
    } else if (current !== undefined && key === "HEAD") {
      current.head = value;
    } else if (current !== undefined && key === "branch") {
      current.branch = value.replace(/^refs\/heads\//, "");
    } else if (current !== undefined && key === "bare") {
      current.bare = true;
    } else if (current !== undefined && key === "detached") {
      current.detached = true;
    } else if (current !== undefined && key === "prunable") {
      current.prunable = true;
    }
  }
  if (current !== undefined) {
    entries.push(current);
  }
  return entries;
}

export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const result = await git(cwd, ["worktree", "list", "--porcelain"]);
  return parseWorktreeList(result.stdout);
}

async function gitConfig(
  cwd: string,
  args: string[],
  worktree = false,
): Promise<string | undefined> {
  const result = await git(
    cwd,
    ["config", ...(worktree ? ["--worktree"] : []), "--get", ...args],
    true,
  );
  return result.code === 0 ? result.stdout.trim() : undefined;
}

async function sharedHookWarnings(root: string): Promise<CheckMessage[]> {
  const common = await git(root, ["rev-parse", "--git-common-dir"], true);
  if (common.code !== 0) {
    return [];
  }
  const commonDir = isAbsolute(common.stdout.trim())
    ? common.stdout.trim()
    : resolve(root, common.stdout.trim());
  const messages: CheckMessage[] = [];
  for (const hook of ["pre-commit", "pre-push", "prepare-commit-msg"]) {
    const hookPath = join(commonDir, "hooks", hook);
    if (!(await pathExists(hookPath))) {
      continue;
    }
    const content = await readFile(hookPath, "utf8");
    if (content.includes("/worktrees/")) {
      messages.push({
        level: "warn",
        message: `${hookPath} contains an absolute managed-worktree path; per-worktree .githooks should make it inert.`,
      });
    }
  }
  return messages;
}

export function githubRepoFromRemoteUrl(url: string): string | undefined {
  const trimmed = url.trim().replace(/\.git$/, "");
  const sshMatch = /^git@github\.com:([^/]+\/[^/]+)$/.exec(trimmed);
  if (sshMatch !== null) {
    return sshMatch[1];
  }
  const httpsMatch = /^https:\/\/github\.com\/([^/]+\/[^/]+)$/.exec(trimmed);
  return httpsMatch?.[1];
}

async function githubRepoFromOrigin(cwd: string): Promise<string | undefined> {
  const result = await git(cwd, ["remote", "get-url", "origin"], true);
  if (result.code !== 0) {
    return undefined;
  }
  return githubRepoFromRemoteUrl(result.stdout);
}

async function defaultResolvePr(branch: string, cwd: string): Promise<PrStatus | undefined> {
  const repo = await githubRepoFromOrigin(cwd);
  const result = await runCommand(
    "gh",
    [
      "pr",
      "view",
      branch,
      "--json",
      "number,state,mergeStateStatus,url",
      ...(repo === undefined ? [] : ["--repo", repo]),
    ],
    {
      cwd,
      allowFailure: true,
    },
  );
  if (result.code !== 0) {
    return undefined;
  }
  const parsed = JSON.parse(result.stdout) as {
    number?: number;
    state?: "OPEN" | "MERGED" | "CLOSED";
    mergeStateStatus?: string;
    url?: string;
  };
  return {
    branch,
    mergeStateStatus: parsed.mergeStateStatus,
    number: parsed.number,
    state: parsed.state ?? "UNKNOWN",
    url: parsed.url,
  };
}

export async function doctorWorktreeWorkflow(
  cwd = process.cwd(),
  options: DoctorOptions = {},
): Promise<DoctorResult> {
  const messages: CheckMessage[] = [];
  const root = await repoRoot(cwd).catch(() => undefined);
  if (root === undefined) {
    return { ok: false, messages: [{ level: "error", message: "Not inside a Git worktree." }] };
  }

  const isInside = await git(root, ["rev-parse", "--is-inside-work-tree"], true);
  if (isInside.stdout.trim() === "true") {
    messages.push({ level: "ok", message: "Git sees current directory as a worktree." });
  } else {
    messages.push({ level: "error", message: "Git does not see current directory as a worktree." });
  }

  const bare = await gitConfig(root, ["core.bare"]);
  if (bare === "false") {
    messages.push({ level: "ok", message: "core.bare=false." });
  } else {
    messages.push({ level: "error", message: `core.bare is ${bare ?? "unset"}; expected false.` });
  }

  const worktreeConfig = await gitConfig(root, ["extensions.worktreeConfig"]);
  if (worktreeConfig === "true") {
    messages.push({ level: "ok", message: "extensions.worktreeConfig=true." });
  } else {
    messages.push({
      level: "error",
      message: `extensions.worktreeConfig is ${worktreeConfig ?? "unset"}; expected true.`,
    });
  }

  const hooksPath = await gitConfig(root, ["core.hooksPath"], true);
  if (hooksPath === ".githooks") {
    messages.push({ level: "ok", message: "Per-worktree core.hooksPath=.githooks." });
  } else {
    messages.push({
      level: "error",
      message: `Per-worktree core.hooksPath is ${hooksPath ?? "unset"}; expected .githooks.`,
    });
  }

  for (const hook of ["pre-commit", "pre-push"]) {
    const hookPath = join(root, ".githooks", hook);
    if (await executable(hookPath)) {
      messages.push({ level: "ok", message: `${hookPath} exists and is executable.` });
    } else {
      messages.push({ level: "error", message: `${hookPath} is missing or not executable.` });
    }
  }

  messages.push(...(await sharedHookWarnings(root)));

  const worktrees = await listWorktrees(root);
  const mainWorktree = worktrees.find((entry) => entry.branch === "main");
  if (mainWorktree !== undefined) {
    const status = await git(mainWorktree.path, ["status", "--porcelain"], true);
    if (status.code !== 0) {
      messages.push({
        level: "error",
        message: `Could not read main worktree status at ${mainWorktree.path}.`,
      });
    } else if (status.stdout.trim().length === 0) {
      messages.push({ level: "ok", message: `Main worktree is clean at ${mainWorktree.path}.` });
    } else {
      messages.push({ level: "error", message: `Main worktree is dirty at ${mainWorktree.path}.` });
    }
  } else {
    messages.push({
      level: "warn",
      message: "No registered worktree currently has branch main checked out.",
    });
  }

  for (const entry of worktrees) {
    if (entry.prunable === true || !(await pathExists(entry.path))) {
      messages.push({ level: "warn", message: `Stale worktree entry: ${entry.path}.` });
    }
    if (entry.branch !== undefined && entry.branch !== "main") {
      const resolver = options.resolvePr ?? defaultResolvePr;
      const pr = await resolver(entry.branch, entry.path);
      if (pr === undefined) {
        messages.push({ level: "warn", message: `No PR status found for branch ${entry.branch}.` });
      } else if (pr.state === "OPEN" && pr.mergeStateStatus === "DIRTY") {
        messages.push({
          level: "warn",
          message: `PR #${pr.number ?? "?"} for ${entry.branch} is open but conflicting.`,
        });
      } else {
        messages.push({
          level: "ok",
          message: `PR status for ${entry.branch}: ${pr.state}${pr.mergeStateStatus ? `/${pr.mergeStateStatus}` : ""}.`,
        });
      }
    }
  }

  if (options.checkRemote !== false) {
    const remotePrune = await git(root, ["remote", "prune", "--dry-run", "origin"], true);
    if (remotePrune.code === 0 && remotePrune.stdout.trim().length > 0) {
      messages.push({
        level: "warn",
        message: "origin has stale remote refs; run bun run worktree:cleanup -- --apply.",
      });
    } else if (remotePrune.code === 0) {
      messages.push({
        level: "ok",
        message: "No stale origin refs reported by remote prune dry-run.",
      });
    } else {
      messages.push({ level: "warn", message: "Could not check stale origin refs." });
    }
  }

  return { ok: !messages.some((message) => message.level === "error"), messages };
}

async function worktreeClean(path: string): Promise<boolean> {
  const result = await git(path, ["status", "--porcelain"], true);
  return result.code === 0 && result.stdout.trim().length === 0;
}

export async function cleanupWorktrees(
  cwd = process.cwd(),
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const root = await repoRoot(cwd);
  const worktrees = await listWorktrees(root);
  const current = await repoRoot(process.cwd()).catch(() => undefined);
  const actions: CleanupAction[] = [];
  const resolver = options.resolvePr ?? defaultResolvePr;

  for (const entry of worktrees) {
    if (
      entry.path === root ||
      entry.path === current ||
      entry.branch === "main" ||
      entry.branch === undefined
    ) {
      actions.push({
        action: "skip",
        branch: entry.branch,
        path: entry.path,
        reason: "primary/current/main worktree",
      });
      continue;
    }
    if (!(await worktreeClean(entry.path))) {
      actions.push({
        action: "skip",
        branch: entry.branch,
        path: entry.path,
        reason: "worktree is dirty",
      });
      continue;
    }
    const pr = await resolver(entry.branch, entry.path);
    if (pr === undefined) {
      actions.push({
        action: "skip",
        branch: entry.branch,
        path: entry.path,
        reason: "no PR status found",
      });
      continue;
    }
    if (pr.state !== "MERGED" && pr.state !== "CLOSED") {
      actions.push({
        action: "skip",
        branch: entry.branch,
        path: entry.path,
        reason: `PR state is ${pr.state}`,
      });
      continue;
    }

    actions.push({
      action: "remove-worktree",
      branch: entry.branch,
      path: entry.path,
      reason: `PR state is ${pr.state}`,
    });
    if (options.apply === true) {
      await git(root, ["worktree", "remove", entry.path]);
    }
  }

  if (options.prune !== false) {
    actions.push({
      action: "prune-origin",
      reason: options.apply === true ? "fetch --prune" : "dry-run",
    });
    if (options.apply === true) {
      await git(root, ["fetch", "origin", "--prune"]);
    } else {
      await git(root, ["remote", "prune", "--dry-run", "origin"], true);
    }
  }

  return { actions, applied: options.apply === true };
}

export async function syncMain(
  cwd = process.cwd(),
  options: SyncMainOptions = {},
): Promise<CheckMessage[]> {
  const root = await repoRoot(cwd);
  const messages: CheckMessage[] = [];
  await git(root, ["fetch", "origin", "--prune"]);
  const worktrees = await listWorktrees(root);
  const mainWorktree = worktrees.find((entry) => entry.branch === "main");

  if (mainWorktree !== undefined) {
    const clean = await worktreeClean(mainWorktree.path);
    if (!clean && options.discardLocalChanges !== true) {
      return [
        {
          level: "error",
          message: `Main worktree at ${mainWorktree.path} is dirty; pass --discard-local-changes to reset it.`,
        },
      ];
    }
    await git(mainWorktree.path, ["reset", "--hard", "origin/main"]);
    messages.push({
      level: "ok",
      message: `Reset main worktree to origin/main at ${mainWorktree.path}.`,
    });
    return messages;
  }

  const currentBranch = (await git(root, ["branch", "--show-current"], true)).stdout.trim();
  if (currentBranch === "main") {
    const clean = await worktreeClean(root);
    if (!clean && options.discardLocalChanges !== true) {
      return [
        {
          level: "error",
          message: "Current main worktree is dirty; pass --discard-local-changes to reset it.",
        },
      ];
    }
    await git(root, ["reset", "--hard", "origin/main"]);
    messages.push({ level: "ok", message: "Reset current main worktree to origin/main." });
    return messages;
  }

  await git(root, ["branch", "--force", "main", "origin/main"]);
  messages.push({
    level: "ok",
    message: "Updated local main ref to origin/main; main is not checked out.",
  });
  return messages;
}

export async function createTempDir(prefix = "agent-trail-worktree-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTempDir(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}
