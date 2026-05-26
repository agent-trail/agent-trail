// Canonical normalization for vcs.remote_url (§8.2). All adapters route
// their raw remote URL through normalizeRemoteUrl before emission so that
// SSH and HTTPS variants of the same repository collapse to one canonical
// form and credentials are stripped.
//
// Canonical form for git URLs:
//   - https://<host>[:port]/<path>      (no trailing .git, no userinfo)
// Other VCS (hg, svn) keep their protocol but lose userinfo and surrounding
// whitespace.

const SCP_SSH_PATTERN = /^([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+):(.+)$/;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
// Userinfo with explicit password component (user:pass@host). url-encoded
// passwords stay caught because the ":" stays literal in the userinfo.
const EMBEDDED_CREDENTIALS_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]*:[^/@\s]+@/i;

export function hasEmbeddedCredentials(raw: string): boolean {
  return EMBEDDED_CREDENTIALS_PATTERN.test(raw);
}

export function normalizeRemoteUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  const scpMatch = SCP_SSH_PATTERN.exec(trimmed);
  if (scpMatch !== null && !URL_SCHEME_PATTERN.test(trimmed)) {
    const host = scpMatch[2] ?? "";
    const path = scpMatch[3] ?? "";
    return `https://${host}/${stripDotGit(path)}`;
  }

  if (!URL_SCHEME_PATTERN.test(trimmed)) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }

  url.username = "";
  url.password = "";

  const protocol = url.protocol.toLowerCase();
  if (protocol === "ssh:" || protocol === "git:" || protocol === "git+ssh:") {
    const host = url.host;
    const path = stripDotGit(url.pathname.replace(/^\/+/, ""));
    return `https://${host}/${path}`;
  }

  const pathname = stripDotGit(url.pathname);
  return `${url.protocol}//${url.host}${pathname}${url.search}${url.hash}`;
}

function stripDotGit(path: string): string {
  return path.endsWith(".git") ? path.slice(0, -4) : path;
}

export type HeaderVcs = {
  type: "git";
  revision: string;
  remote_url?: string;
};

// Resolves a git working tree's vcs header block. Runs git binaries against
// the supplied cwd. Returns undefined if cwd is not a git working tree or git
// is unavailable. When the source agent stores its own revision/remote, the
// adapter should prefer that and skip this helper.
export async function readGitVcs(cwd: string): Promise<HeaderVcs | undefined> {
  const revision = await runGit(["rev-parse", "HEAD"], cwd);
  if (revision === undefined) return undefined;
  const remoteRaw = await runGit(["config", "--get", "remote.origin.url"], cwd);
  const vcs: HeaderVcs = { type: "git", revision: revision.trim() };
  if (remoteRaw !== undefined) {
    const normalized = normalizeRemoteUrl(remoteRaw);
    if (normalized !== undefined) vcs.remote_url = normalized;
  }
  return vcs;
}

async function runGit(args: string[], cwd: string): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return undefined;
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
