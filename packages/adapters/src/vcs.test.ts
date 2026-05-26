import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasEmbeddedCredentials, normalizeRemoteUrl, readGitVcs } from "./vcs";

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

  async function git(args: string[]): Promise<void> {
    const proc = Bun.spawn(["git", ...args], { cwd: tmp, stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${code}`);
  }

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
