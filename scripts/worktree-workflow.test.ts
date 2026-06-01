import { expect, test } from "bun:test";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupWorktrees,
  createTempDir,
  doctorWorktreeWorkflow,
  git,
  githubRepoFromRemoteUrl,
  type PrStatus,
  removeTempDir,
  setupWorktreeWorkflow,
  syncMain,
} from "./worktree-workflow-lib.ts";

async function withTempDir<T>(run: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = await createTempDir();
  try {
    return await run(tempDir);
  } finally {
    await removeTempDir(tempDir);
  }
}

async function initRepo(tempDir: string, name = "repo"): Promise<string> {
  const repo = join(tempDir, name);
  await mkdir(repo, { recursive: true });
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "tester@example.com"]);
  await git(repo, ["config", "user.name", "Tester"]);
  await mkdir(join(repo, ".githooks"));
  await writeFile(join(repo, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
  await writeFile(join(repo, ".githooks", "pre-push"), "#!/bin/sh\nexit 0\n");
  await chmod(join(repo, ".githooks", "pre-commit"), 0o755);
  await chmod(join(repo, ".githooks", "pre-push"), 0o755);
  await writeFile(join(repo, "README.md"), "test\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "init"]);
  return repo;
}

async function addOrigin(tempDir: string, repo: string): Promise<string> {
  const origin = join(tempDir, "origin.git");
  await git(tempDir, ["init", "--bare", origin]);
  await git(repo, ["remote", "add", "origin", origin]);
  await git(repo, ["push", "-u", "origin", "main"]);
  await git(origin, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  return origin;
}

function prResolver(statuses: Record<string, PrStatus>) {
  return async (branch: string): Promise<PrStatus | undefined> => statuses[branch];
}

test("githubRepoFromRemoteUrl parses GitHub origin URLs", () => {
  expect(githubRepoFromRemoteUrl("git@github.com:agent-trail/agent-trail.git")).toBe(
    "agent-trail/agent-trail",
  );
  expect(githubRepoFromRemoteUrl("https://github.com/agent-trail/agent-trail.git")).toBe(
    "agent-trail/agent-trail",
  );
  expect(
    githubRepoFromRemoteUrl("https://example.com/agent-trail/agent-trail.git"),
  ).toBeUndefined();
});

test("setup configures normal main worktree", async () => {
  await withTempDir(async (tempDir) => {
    const repo = await initRepo(tempDir);

    const messages = await setupWorktreeWorkflow(repo);

    expect(messages.some((message) => message.level === "error")).toBe(false);
    expect((await git(repo, ["config", "--get", "core.bare"])).stdout.trim()).toBe("false");
    expect((await git(repo, ["config", "--get", "extensions.worktreeConfig"])).stdout.trim()).toBe(
      "true",
    );
    expect(
      (await git(repo, ["config", "--worktree", "--get", "core.hooksPath"])).stdout.trim(),
    ).toBe(".githooks");
  });
});

test("setup configures linked worktree without changing branch", async () => {
  await withTempDir(async (tempDir) => {
    const repo = await initRepo(tempDir);
    const linked = join(tempDir, "linked");
    await git(repo, ["worktree", "add", "-b", "feature", linked]);

    await setupWorktreeWorkflow(linked);

    expect((await git(linked, ["branch", "--show-current"])).stdout.trim()).toBe("feature");
    expect(
      (await git(linked, ["config", "--worktree", "--get", "core.hooksPath"])).stdout.trim(),
    ).toBe(".githooks");
  });
});

test("setup repairs core.bare=true on primary worktree", async () => {
  await withTempDir(async (tempDir) => {
    const repo = await initRepo(tempDir);
    await git(repo, ["config", "core.bare", "true"]);

    await setupWorktreeWorkflow(repo);

    expect((await git(repo, ["config", "--get", "core.bare"])).stdout.trim()).toBe("false");
    expect((await git(repo, ["status", "--short"])).stdout.trim()).toBe("");
  });
});

test("doctor warns when shared hooks contain managed worktree paths", async () => {
  await withTempDir(async (tempDir) => {
    const repo = await initRepo(tempDir);
    await setupWorktreeWorkflow(repo);
    await writeFile(
      join(repo, ".git", "hooks", "pre-push"),
      "#!/bin/sh\n/tmp/managed/worktrees/c929/agent-trail/node_modules/.bin/lefthook\n",
    );

    const result = await doctorWorktreeWorkflow(repo, {
      checkRemote: false,
      resolvePr: prResolver({}),
    });

    expect(result.ok).toBe(true);
    expect(
      result.messages.some(
        (message) => message.level === "warn" && message.message.includes("managed-worktree"),
      ),
    ).toBe(true);
  });
});

test("cleanup dry-run reports merged clean PR worktree without removing it", async () => {
  await withTempDir(async (tempDir) => {
    const repo = await initRepo(tempDir);
    const linked = join(tempDir, "merged-worktree");
    await git(repo, ["worktree", "add", "-b", "feature/merged", linked]);

    const result = await cleanupWorktrees(repo, {
      resolvePr: prResolver({ "feature/merged": { branch: "feature/merged", state: "MERGED" } }),
    });

    expect(result.applied).toBe(false);
    expect(
      result.actions.some(
        (action) => action.action === "remove-worktree" && action.branch === "feature/merged",
      ),
    ).toBe(true);
    expect((await git(repo, ["worktree", "list", "--porcelain"])).stdout).toContain(linked);
  });
});

test("cleanup apply removes merged clean PR worktree", async () => {
  await withTempDir(async (tempDir) => {
    const repo = await initRepo(tempDir);
    const linked = join(tempDir, "merged-worktree");
    await git(repo, ["worktree", "add", "-b", "feature/merged", linked]);

    await cleanupWorktrees(repo, {
      apply: true,
      prune: false,
      resolvePr: prResolver({ "feature/merged": { branch: "feature/merged", state: "MERGED" } }),
    });

    expect((await git(repo, ["worktree", "list", "--porcelain"])).stdout).not.toContain(linked);
  });
});

test("cleanup keeps open PR worktree", async () => {
  await withTempDir(async (tempDir) => {
    const repo = await initRepo(tempDir);
    const linked = join(tempDir, "open-worktree");
    await git(repo, ["worktree", "add", "-b", "feature/open", linked]);

    const result = await cleanupWorktrees(repo, {
      apply: true,
      prune: false,
      resolvePr: prResolver({ "feature/open": { branch: "feature/open", state: "OPEN" } }),
    });

    expect(
      result.actions.some((action) => action.branch === "feature/open" && action.action === "skip"),
    ).toBe(true);
    expect((await git(repo, ["worktree", "list", "--porcelain"])).stdout).toContain(linked);
  });
});

test("sync-main updates main ref when main is not checked out", async () => {
  await withTempDir(async (tempDir) => {
    const repo = await initRepo(tempDir);
    const origin = await addOrigin(tempDir, repo);
    await git(repo, ["checkout", "-b", "feature"]);

    const clone = join(tempDir, "clone");
    await git(tempDir, ["clone", "--branch", "main", origin, clone]);
    await git(clone, ["config", "user.email", "tester@example.com"]);
    await git(clone, ["config", "user.name", "Tester"]);
    await writeFile(join(clone, "README.md"), "changed\n");
    await git(clone, ["commit", "-am", "change"]);
    await git(clone, ["push", "origin", "main"]);

    const messages = await syncMain(repo);

    expect(messages.some((message) => message.level === "error")).toBe(false);
    expect((await git(repo, ["rev-parse", "main"])).stdout.trim()).toBe(
      (await git(repo, ["rev-parse", "origin/main"])).stdout.trim(),
    );
  });
});
