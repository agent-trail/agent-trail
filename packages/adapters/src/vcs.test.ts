import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv, hasEmbeddedCredentials, normalizeRemoteUrl, readGitVcs } from "./vcs";

describe("normalizeRemoteUrl", () => {
  test("strips trailing .git from https url", () => {
    expect(normalizeRemoteUrl("https://github.com/agent-trail/agent-trail.git")).toBe(
      "https://github.com/agent-trail/agent-trail",
    );
  });

  test("passes through bare https url unchanged", () => {
    expect(normalizeRemoteUrl("https://github.com/agent-trail/agent-trail")).toBe(
      "https://github.com/agent-trail/agent-trail",
    );
  });

  test("converts scp-style ssh git url to canonical https form", () => {
    expect(normalizeRemoteUrl("git@github.com:agent-trail/agent-trail.git")).toBe(
      "https://github.com/agent-trail/agent-trail",
    );
  });

  test("converts ssh:// scheme url to canonical https form", () => {
    expect(normalizeRemoteUrl("ssh://git@github.com/agent-trail/agent-trail.git")).toBe(
      "https://github.com/agent-trail/agent-trail",
    );
  });

  test("strips embedded user:pass credentials from https url", () => {
    expect(normalizeRemoteUrl("https://alice:s3cret@github.com/org/repo.git")).toBe(
      "https://github.com/org/repo",
    );
  });

  test("strips embedded url-encoded credentials", () => {
    expect(normalizeRemoteUrl("https://alice:s%40cret@github.com/org/repo.git")).toBe(
      "https://github.com/org/repo",
    );
  });

  test("strips bare username from https url", () => {
    expect(normalizeRemoteUrl("https://alice@github.com/org/repo.git")).toBe(
      "https://github.com/org/repo",
    );
  });

  test("ssh + https variants normalize to the same canonical form", () => {
    const https = normalizeRemoteUrl("https://github.com/org/repo.git");
    const ssh = normalizeRemoteUrl("git@github.com:org/repo.git");
    const sshScheme = normalizeRemoteUrl("ssh://git@github.com/org/repo.git");
    expect(ssh).toBe(https);
    expect(sshScheme).toBe(https);
  });

  test("preserves http scheme (no upgrade)", () => {
    expect(normalizeRemoteUrl("http://gitserver.local/org/repo.git")).toBe(
      "http://gitserver.local/org/repo",
    );
  });

  test("preserves nested path segments", () => {
    expect(normalizeRemoteUrl("git@gitlab.com:group/sub/project.git")).toBe(
      "https://gitlab.com/group/sub/project",
    );
  });

  test("preserves port in ssh:// url", () => {
    expect(normalizeRemoteUrl("ssh://git@example.com:2222/org/repo.git")).toBe(
      "https://example.com:2222/org/repo",
    );
  });

  test("preserves non-git protocols (hg, svn) but strips credentials", () => {
    expect(normalizeRemoteUrl("https://user:pw@hg.example.com/repo")).toBe(
      "https://hg.example.com/repo",
    );
  });

  test("trims surrounding whitespace and newline", () => {
    expect(normalizeRemoteUrl("  https://github.com/org/repo.git\n")).toBe(
      "https://github.com/org/repo",
    );
  });

  test("returns undefined for empty or whitespace input", () => {
    expect(normalizeRemoteUrl("")).toBeUndefined();
    expect(normalizeRemoteUrl("   ")).toBeUndefined();
  });

  test("returns undefined for non-string input", () => {
    expect(normalizeRemoteUrl(undefined)).toBeUndefined();
    expect(normalizeRemoteUrl(null)).toBeUndefined();
    expect(normalizeRemoteUrl(42 as unknown as string)).toBeUndefined();
  });

  test("hasEmbeddedCredentials detects user:pass form", () => {
    expect(hasEmbeddedCredentials("https://alice:s3cret@github.com/org/repo")).toBe(true);
    expect(hasEmbeddedCredentials("https://alice:s%40cret@github.com/org/repo")).toBe(true);
    expect(hasEmbeddedCredentials("https://github.com/org/repo")).toBe(false);
    expect(hasEmbeddedCredentials("git@github.com:org/repo.git")).toBe(false);
  });
});

describe("readGitVcs", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "vcs-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  async function git(args: string[], cwd = tmp): Promise<string> {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      env: cleanGitEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${code}: ${stderr}`);
    return stdout.trim();
  }

  async function initRepo(cwd: string, message: string): Promise<string> {
    await git(["init", "-q"], cwd);
    await git(
      [
        "-c",
        "user.email=a@b",
        "-c",
        "user.name=Tester",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        message,
      ],
      cwd,
    );
    return git(["rev-parse", "HEAD"], cwd);
  }

  test("cleanGitEnv removes Git hook-local environment while preserving unrelated keys", () => {
    expect(
      cleanGitEnv({
        PATH: "/bin",
        HOME: "/tmp/home",
        GIT_DIR: "/tmp/repo/.git",
        GIT_WORK_TREE: "/tmp/repo",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "safe.directory",
        GIT_CONFIG_VALUE_0: "*",
      }),
    ).toEqual({ PATH: "/bin", HOME: "/tmp/home" });
  });

  test("ignores inherited Git hook environment when reading a target cwd", async () => {
    const outer = mkdtempSync(join(tmpdir(), "vcs-outer-"));
    const inner = mkdtempSync(join(tmpdir(), "vcs-inner-"));
    const previousGitDir = process.env.GIT_DIR;
    const previousGitWorkTree = process.env.GIT_WORK_TREE;
    try {
      const outerRevision = await initRepo(outer, "outer");
      const innerRevision = await initRepo(inner, "inner");

      process.env.GIT_DIR = join(outer, ".git");
      process.env.GIT_WORK_TREE = outer;

      const vcs = await readGitVcs(inner);
      expect(outerRevision).not.toBe(innerRevision);
      expect(vcs?.revision).toBe(innerRevision);
    } finally {
      if (previousGitDir === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = previousGitDir;
      }
      if (previousGitWorkTree === undefined) {
        delete process.env.GIT_WORK_TREE;
      } else {
        process.env.GIT_WORK_TREE = previousGitWorkTree;
      }
      rmSync(outer, { recursive: true, force: true });
      rmSync(inner, { recursive: true, force: true });
    }
  });

  test("returns undefined for a non-git directory", async () => {
    const vcs = await readGitVcs(tmp);
    expect(vcs).toBeUndefined();
  });

  test("returns type+revision when cwd is a git working tree without a remote", async () => {
    await git(["init", "-q"]);
    await git([
      "-c",
      "user.email=a@b",
      "-c",
      "user.name=Tester",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ]);
    const vcs = await readGitVcs(tmp);
    expect(vcs).toBeDefined();
    expect(vcs?.type).toBe("git");
    expect(vcs?.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(vcs?.remote_url).toBeUndefined();
  });

  test("returns branch with null revision for an unborn git HEAD", async () => {
    await git(["init", "-q", "--initial-branch", "main"]);
    await git(["remote", "add", "origin", "git@github.com:agent-trail/agent-trail.git"]);
    const vcs = await readGitVcs(tmp);
    expect(vcs).toEqual({
      type: "git",
      revision: null,
      branch: "main",
      remote_url: "https://github.com/agent-trail/agent-trail",
    });
  });

  test("returns a normalized remote_url when origin remote is set", async () => {
    await git(["init", "-q"]);
    await git([
      "-c",
      "user.email=a@b",
      "-c",
      "user.name=Tester",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ]);
    await git(["remote", "add", "origin", "git@github.com:agent-trail/agent-trail.git"]);
    const vcs = await readGitVcs(tmp);
    expect(vcs?.remote_url).toBe("https://github.com/agent-trail/agent-trail");
  });

  test("prefers origin remote over upstream when both are configured", async () => {
    await git(["init", "-q"]);
    await git([
      "-c",
      "user.email=a@b",
      "-c",
      "user.name=Tester",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ]);
    await git([
      "remote",
      "add",
      "upstream",
      "https://github.com/agent-trail/agent-trail-upstream.git",
    ]);
    await git(["remote", "add", "origin", "https://github.com/agent-trail/agent-trail.git"]);
    const vcs = await readGitVcs(tmp);
    expect(vcs?.remote_url).toBe("https://github.com/agent-trail/agent-trail");
  });

  test("strips embedded credentials when origin url has user:pass", async () => {
    await git(["init", "-q"]);
    await git([
      "-c",
      "user.email=a@b",
      "-c",
      "user.name=Tester",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ]);
    await git(["remote", "add", "origin", "https://alice:s3cret@github.com/org/repo.git"]);
    const vcs = await readGitVcs(tmp);
    expect(vcs?.remote_url).toBe("https://github.com/org/repo");
  });
});
