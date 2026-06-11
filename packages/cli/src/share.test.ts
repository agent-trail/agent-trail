import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  canonicalizeRecords,
  computeContentHash,
  computeTrailEnvelopeContentHash,
  parseJsonlString,
  stampTrail,
  verifyContentHash,
  verifyTrailEnvelopeContentHash,
} from "@agent-trail/core";
import { objectPath, registerTrail } from "@agent-trail/store";
import { runCli } from "./cli-runtime.ts";
import type { RunShareContext, RunShareOptions, RunShareResult } from "./share.ts";
import { runShare as runShareCommand } from "./share.ts";

function decodePayload(payload: Uint8Array): string {
  const base64 = Buffer.from(payload).toString("ascii");
  return gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
}

type SeedOpts = {
  agentName?: string;
  cwd?: string;
  extraRecords?: Record<string, unknown>[];
  id?: string;
  text?: string;
  vcs?: Record<string, unknown>;
  /** Skip the content_hash stamp so the trail enters `registerTrail` as pending. */
  stampHash?: boolean;
};

async function seedTrail(opts: SeedOpts = {}): Promise<{ filePath: string; contentHash: string }> {
  const agentName = opts.agentName ?? "codex-cli";
  const cwd = opts.cwd ?? "/work/proj-a";
  const id = opts.id ?? "01HSESS0000000000000000001";
  const text = opts.text ?? "hello";
  const stampHash = opts.stampHash ?? true;
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id,
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: agentName },
    cwd,
  };
  if (opts.vcs !== undefined) header.vcs = opts.vcs;
  const userMsg = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text },
  };
  const records = [header, userMsg, ...(opts.extraRecords ?? [])];
  const draftBytes = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const draftRecords = await parseJsonlString(draftBytes);
  const contentHash = computeContentHash(draftRecords);
  if (stampHash) {
    header.content_hash = contentHash;
  }
  const finalRecords = await parseJsonlString(
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  const canonical = canonicalizeRecords(finalRecords);

  const dir = mkdtempSync(join(tmpdir(), "trail-cli-share-input-"));
  const filePath = join(dir, "session.trail.jsonl");
  await writeFile(filePath, canonical, "utf8");
  return { filePath, contentHash };
}

async function seedRegistered(
  opts: SeedOpts = {},
): Promise<{ filePath: string; contentHash: string }> {
  const seed = await seedTrail(opts);
  const reg = await registerTrail(seed.filePath, { storeRoot });
  if (reg.contentHash === null) throw new Error(`seed register failed: ${reg.status}`);
  return { filePath: seed.filePath, contentHash: reg.contentHash };
}

let storeRoot: string;

function shareOptions(argv: string[]): RunShareOptions {
  const options: Partial<RunShareOptions> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--skip-redaction") {
      options.skipRedaction = true;
    } else if (arg === "--keep-remote-url") {
      options.keepRemoteUrl = true;
    } else if (arg === "--allowed-secret") {
      i += 1;
      options.allowedSecrets ??= [];
      options.allowedSecrets.push(argv[i] ?? "");
    } else if (arg === "--json") {
      options.json = true;
    } else if (options.id === undefined) {
      options.id = arg;
    }
  }
  if (options.id === undefined) throw new Error("test helper missing id");
  return options as RunShareOptions;
}

function runShare(argv: string[], context: RunShareContext = {}): Promise<RunShareResult> {
  return runShareCommand(shareOptions(argv), context);
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-share-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

test("missing id arg: exits 1 with usage on stderr", async () => {
  const result = await runCli(["share"]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Usage: trail share");
});

test("file path input is rejected and not registered", async () => {
  const { filePath } = await seedTrail();
  const result = await runShare([filePath, "--dry-run"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("share: invalid id");
});

test("normal mode, confirm accepted: registers, prints summary, uploads and prints viewer URL", async () => {
  const { contentHash } = await seedRegistered();
  const confirmCalls: string[] = [];
  const confirm = async (msg: string): Promise<boolean> => {
    confirmCalls.push(msg);
    return true;
  };
  let uploadCalls = 0;
  const gistUpload = async () => {
    uploadCalls += 1;
    return { gistId: "abc123" };
  };

  const result = await runShare([contentHash], { storeRoot, confirm, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Redaction summary");
  expect(result.stdout).toContain(contentHash.slice(0, 12));
  expect(result.stdout).toContain("https://agent-trail.dev/view/gist/abc123");
  expect(result.stdout).not.toContain("Upload pending");
  expect(confirmCalls).toHaveLength(1);
  expect(uploadCalls).toBe(1);
});

test("unknown full hash: exits 1 with diagnostic, no confirm or upload", async () => {
  const missing = "0".repeat(64);
  let confirmCalled = false;
  const confirm = async (): Promise<boolean> => {
    confirmCalled = true;
    return true;
  };
  let uploadCalled = false;
  const gistUpload = async () => {
    uploadCalled = true;
    return { gistId: "should-not-happen" };
  };

  const result = await runShare([missing], { storeRoot, confirm, gistUpload });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(`share: unknown id: ${missing}`);
  expect(confirmCalled).toBe(false);
  expect(uploadCalled).toBe(false);
});

test("unregistered full hash with existing object file is rejected", async () => {
  const { filePath, contentHash } = await seedTrail();
  const target = objectPath(storeRoot, contentHash);
  mkdirSync(dirname(target), { recursive: true });
  await writeFile(target, await Bun.file(filePath).text(), "utf8");
  let uploadCalled = false;
  const gistUpload = async () => {
    uploadCalled = true;
    return { gistId: "should-not-upload" };
  };

  const result = await runShare([contentHash, "--json"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(`share: unknown id: ${contentHash}`);
  expect(JSON.parse(result.stdout)).toEqual({
    status: "error",
    content_hash: null,
    redaction: null,
    copied: false,
    error: { message: `share: unknown id: ${contentHash}` },
  });
  expect(uploadCalled).toBe(false);
});

test("--json unknown id emits parseable error object", async () => {
  const missing = "0".repeat(64);

  const result = await runShare([missing, "--json"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(`share: unknown id: ${missing}`);
  expect(JSON.parse(result.stdout)).toEqual({
    status: "error",
    content_hash: null,
    redaction: null,
    copied: false,
    error: { message: `share: unknown id: ${missing}` },
  });
});

test("--json invalid id emits parseable error object", async () => {
  const result = await runShare(["not-a-hash", "--json"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("share: invalid id");
  expect(JSON.parse(result.stdout)).toEqual({
    status: "error",
    content_hash: null,
    redaction: null,
    copied: false,
    error: { message: "share: invalid id: not-a-hash (expected 8–64 hex chars)" },
  });
});

test("dry-run json fails deterministically for malformed project redaction settings", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-cli-share-bad-settings-project-"));
  try {
    mkdirSync(join(projectRoot, ".trail"), { recursive: true });
    await writeFile(join(projectRoot, ".trail", "settings.json"), "{", "utf8");
    const { contentHash } = await seedRegistered();

    const result = await runShare([contentHash, "--dry-run", "--json"], {
      storeRoot,
      projectRoot,
      env: { HOME: projectRoot },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("redaction settings invalid JSON");
    expect(JSON.parse(result.stdout)).toEqual({
      status: "error",
      content_hash: null,
      redaction: null,
      copied: false,
      error: { message: expect.stringContaining("redaction settings invalid JSON") },
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("dry-run json loads project redactor packs and reports pack metadata", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-cli-share-pack-project-"));
  try {
    mkdirSync(join(projectRoot, ".trail", "redactors"), { recursive: true });
    await writeFile(
      join(projectRoot, ".trail", "redactors", "acme.yaml"),
      [
        "name: acme",
        "version: 1",
        "description: ACME internal tokens",
        "rules:",
        "  - id: acme_internal_token",
        "    description: ACME internal service token",
        "    regex: 'ACME-[A-Z0-9]{32}'",
        "    placeholder: '[ACME_TOKEN]'",
        "    samples:",
        "      - input: 'ACME-ABCDEF0123456789ABCDEF0123456789'",
        "        redacted: true",
        "      - input: 'ACME-too-short'",
        "        redacted: false",
        "",
      ].join("\n"),
      "utf8",
    );
    const { contentHash } = await seedRegistered({
      text: "token ACME-ABCDEF0123456789ABCDEF0123456789",
    });

    const result = await runShare([contentHash, "--dry-run", "--json"], {
      storeRoot,
      projectRoot,
      env: { HOME: projectRoot },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const json = JSON.parse(result.stdout) as {
      redaction: {
        summary: {
          counts: Record<string, number>;
          packs?: Array<{ name: string; version: number; source: string; contentHash: string }>;
        };
      };
    };
    expect(json.redaction.summary.counts.acme_internal_token).toBe(1);
    expect(json.redaction.summary.packs).toEqual([
      {
        name: "acme",
        version: 1,
        source: "project",
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("dry-run warns and continues for malformed redactor packs", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-cli-share-bad-pack-project-"));
  try {
    mkdirSync(join(projectRoot, ".trail", "redactors", "local"), { recursive: true });
    await writeFile(
      join(projectRoot, ".trail", "redactors", "good.yaml"),
      [
        "name: good",
        "version: 1",
        "rules:",
        "  - id: good_token",
        "    description: Good token",
        "    regex: 'GOOD-[A-Z0-9]{8}'",
        "    placeholder: '[GOOD_TOKEN]'",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(projectRoot, ".trail", "redactors", "local", "broken.yaml"),
      [
        "name: broken",
        "version: 1",
        "rules:",
        "  - id: broken_token",
        "    description: Broken token",
        "    regex: 'BROKEN-[A-Z0-9]{8}'",
        "    placeholder: '[BROKEN_TOKEN]'",
        "    samples:",
        "      - input: 'no match here'",
        "        redacted: true",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(projectRoot, ".trail", "redactors", "invalid.json"), "{", "utf8");
    const { contentHash } = await seedRegistered({ text: "GOOD-ABC12345 BROKEN-ABC12345" });

    const result = await runShare([contentHash, "--dry-run", "--json"], {
      storeRoot,
      projectRoot,
      env: { HOME: projectRoot },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("WARNING: redaction pack skipped");
    expect(result.stderr).toContain("broken.yaml");
    expect(result.stderr).toContain("invalid.json");
    const json = JSON.parse(result.stdout) as {
      redaction: {
        summary: {
          counts: Record<string, number>;
          packs?: Array<{ name: string }>;
        };
      };
    };
    expect(json.redaction.summary.counts.good_token).toBe(1);
    expect(json.redaction.summary.counts.broken_token).toBeUndefined();
    expect(json.redaction.summary.packs).toEqual([expect.objectContaining({ name: "good" })]);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("share applies project redaction settings for PII categories", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-cli-share-settings-project-"));
  try {
    mkdirSync(join(projectRoot, ".trail"), { recursive: true });
    await writeFile(
      join(projectRoot, ".trail", "settings.json"),
      JSON.stringify({
        redaction: {
          pii: {
            email: true,
            phone: true,
            ssn: false,
            credit_card: false,
            name: false,
          },
        },
      }),
      "utf8",
    );
    const { contentHash } = await seedRegistered({
      text: "Contact alice@example.com or 415-555-2671. SSN 123-45-6789. Hello Jonathan Smith.",
    });
    let uploaded: Uint8Array | null = null;
    const gistUpload = async (payload: Uint8Array) => {
      uploaded = payload;
      return { gistId: "settingsid" };
    };

    const result = await runShare([contentHash, "--yes"], {
      storeRoot,
      projectRoot,
      env: { HOME: projectRoot },
      gistUpload,
    });

    expect(result.exitCode).toBe(0);
    if (uploaded === null) throw new Error("expected upload payload");
    const shared = decodePayload(uploaded);
    expect(shared).toContain("[EMAIL]");
    expect(shared).toContain("[PHONE]");
    expect(shared).toContain("123-45-6789");
    expect(shared).toContain("Jonathan Smith");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("share applies project email allowlist settings", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-cli-share-email-allowlist-project-"));
  try {
    mkdirSync(join(projectRoot, ".trail"), { recursive: true });
    await writeFile(
      join(projectRoot, ".trail", "settings.json"),
      JSON.stringify({
        redaction: {
          pii: {
            emailAllowlist: ["*@project.example"],
          },
        },
      }),
      "utf8",
    );
    const { contentHash } = await seedRegistered({
      text: "keep dev@project.example redact alice@example.com",
    });
    let uploaded: Uint8Array | null = null;
    const gistUpload = async (payload: Uint8Array) => {
      uploaded = payload;
      return { gistId: "emailallowid" };
    };

    const result = await runShare([contentHash, "--yes", "--json"], {
      storeRoot,
      projectRoot,
      env: { HOME: projectRoot },
      gistUpload,
    });

    expect(result.exitCode).toBe(0);
    if (uploaded === null) throw new Error("expected upload payload");
    const shared = decodePayload(uploaded);
    expect(shared).toContain("dev@project.example");
    expect(shared).not.toContain("alice@example.com");
    expect(shared).toContain("[EMAIL]");
    const json = JSON.parse(result.stdout) as {
      redaction: { summary: { counts: Record<string, number> } };
    };
    expect(json.redaction.summary.counts.allowlisted_skip).toBe(1);
    expect(json.redaction.summary.counts.email_pii).toBe(1);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("share applies project custom PII label settings", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-cli-share-custom-label-project-"));
  try {
    mkdirSync(join(projectRoot, ".trail"), { recursive: true });
    await writeFile(
      join(projectRoot, ".trail", "settings.json"),
      JSON.stringify({
        redaction: {
          pii: {
            customLabels: { employee_id: "EMP-\\d{6}" },
          },
        },
      }),
      "utf8",
    );
    const { contentHash } = await seedRegistered({
      text: "employee EMP-123456 opened the ticket",
    });
    let uploaded: Uint8Array | null = null;
    const gistUpload = async (payload: Uint8Array) => {
      uploaded = payload;
      return { gistId: "customlabelid" };
    };

    const result = await runShare([contentHash, "--yes", "--json"], {
      storeRoot,
      projectRoot,
      env: { HOME: projectRoot },
      gistUpload,
    });

    expect(result.exitCode).toBe(0);
    if (uploaded === null) throw new Error("expected upload payload");
    const shared = decodePayload(uploaded);
    expect(shared).toContain("[REDACTED_EMPLOYEE_ID]");
    expect(shared).not.toContain("EMP-123456");
    const json = JSON.parse(result.stdout) as {
      redaction: { summary: { counts: Record<string, number> } };
    };
    expect(json.redaction.summary.counts.employee_id_pii).toBe(1);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("share allowed-secret preserves a detector match and reports allowlisted skip", async () => {
  const allowed = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const { contentHash } = await seedRegistered({
    text: `fixture key ${allowed} repeated ${allowed}`,
  });
  let uploaded: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    uploaded = payload;
    return { gistId: "allowedid" };
  };

  const result = await runShare([contentHash, "--yes", "--allowed-secret", allowed, "--json"], {
    storeRoot,
    gistUpload,
  });

  expect(result.exitCode).toBe(0);
  if (uploaded === null) throw new Error("expected upload payload");
  const shared = decodePayload(uploaded);
  expect(shared).toContain(allowed);
  expect(shared.match(new RegExp(allowed, "g"))).toHaveLength(2);
  const json = JSON.parse(result.stdout) as {
    redaction: { summary: { counts: Record<string, number> } };
  };
  expect(json.redaction.summary.counts.allowlisted_skip).toBe(2);
  expect(json.redaction.summary.counts.openai_api_key).toBeUndefined();
});

test("share allowed-secret preserves PII library detector matches", async () => {
  const ssn = "123-45-6789";
  const card = "4111 1111 1111 1111";
  const { contentHash } = await seedRegistered({
    text: `SSN ${ssn} and card ${card}`,
  });
  let uploaded: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    uploaded = payload;
    return { gistId: "allowedpiiid" };
  };

  const result = await runShare(
    [contentHash, "--yes", "--allowed-secret", ssn, "--allowed-secret", card, "--json"],
    {
      storeRoot,
      gistUpload,
    },
  );

  expect(result.exitCode).toBe(0);
  if (uploaded === null) throw new Error("expected upload payload");
  const shared = decodePayload(uploaded);
  expect(shared).toContain(ssn);
  expect(shared).toContain(card);
  const json = JSON.parse(result.stdout) as {
    redaction: { summary: { counts: Record<string, number> } };
  };
  expect(json.redaction.summary.counts.allowlisted_skip).toBe(2);
  expect(json.redaction.summary.counts.ssn_pii).toBeUndefined();
  expect(json.redaction.summary.counts.credit_card_pii).toBeUndefined();
});

test("runCli share passes --allowed-secret through Commander", async () => {
  const allowed = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const { contentHash } = await seedRegistered({
    text: `fixture key ${allowed}`,
  });

  const result = await runCli(
    ["share", contentHash, "--dry-run", "--yes", "--json", "--allowed-secret", allowed],
    { storeRoot },
  );

  expect(result.exitCode).toBe(0);
  const json = JSON.parse(result.stdout) as {
    redaction: { summary: { counts: Record<string, number> } };
  };
  expect(json.redaction.summary.counts.allowlisted_skip).toBe(1);
  expect(json.redaction.summary.counts.openai_api_key).toBeUndefined();
});

test("share applies rule pack allowlist entries as exact skip literals", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-cli-share-pack-allowlist-project-"));
  try {
    const allowed = "ACME-ABCDEF0123456789ABCDEF0123456789";
    mkdirSync(join(projectRoot, ".trail", "redactors"), { recursive: true });
    await writeFile(
      join(projectRoot, ".trail", "redactors", "acme.yaml"),
      [
        "name: acme",
        "version: 1",
        "allowlist:",
        `  - ${allowed}`,
        "rules:",
        "  - id: acme_internal_token",
        "    description: ACME internal service token",
        "    regex: 'ACME-[A-Z0-9]{32}'",
        "    placeholder: '[ACME_TOKEN]'",
        "",
      ].join("\n"),
      "utf8",
    );
    const { contentHash } = await seedRegistered({ text: `fixture key ${allowed}` });
    let uploaded: Uint8Array | null = null;
    const gistUpload = async (payload: Uint8Array) => {
      uploaded = payload;
      return { gistId: "packallowid" };
    };

    const result = await runShare([contentHash, "--yes", "--json"], {
      storeRoot,
      projectRoot,
      env: { HOME: projectRoot },
      gistUpload,
    });

    expect(result.exitCode).toBe(0);
    if (uploaded === null) throw new Error("expected upload payload");
    expect(decodePayload(uploaded)).toContain(allowed);
    const json = JSON.parse(result.stdout) as {
      redaction: { summary: { counts: Record<string, number> } };
    };
    expect(json.redaction.summary.counts.allowlisted_skip).toBe(1);
    expect(json.redaction.summary.counts.acme_internal_token).toBeUndefined();
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("--skip-redaction --yes: warning still printed, unredacted confirm required", async () => {
  const { contentHash } = await seedRegistered();
  let confirmCalled = 0;
  const confirm = async (): Promise<boolean> => {
    confirmCalled += 1;
    return true;
  };
  const gistUpload = async () => ({ gistId: "skipid" });

  const result = await runShare([contentHash, "--skip-redaction", "--yes"], {
    storeRoot,
    confirm,
    gistUpload,
  });

  expect(result.exitCode).toBe(0);
  expect(confirmCalled).toBe(1);
  expect(result.stderr).toContain("WARNING");
  expect(result.stdout).toContain("https://agent-trail.dev/view/gist/skipid");
});

test("--skip-redaction: first confirm yes, second no -> cancelled, no upload pending", async () => {
  const { contentHash } = await seedRegistered();
  let call = 0;
  const confirm = async (): Promise<boolean> => {
    call += 1;
    return call === 1;
  };

  const result = await runShare([contentHash, "--skip-redaction"], { storeRoot, confirm });

  expect(result.exitCode).toBe(0);
  expect(call).toBe(2);
  expect(result.stderr).toContain("WARNING");
  expect(result.stdout).toContain("Share cancelled");
  expect(result.stdout).not.toContain("view/gist/");
});

test("--skip-redaction: stderr warning, two confirms required, both accepted -> uploads and prints viewer URL", async () => {
  const { contentHash } = await seedRegistered();
  const confirmCalls: string[] = [];
  const confirm = async (msg: string): Promise<boolean> => {
    confirmCalls.push(msg);
    return true;
  };
  const gistUpload = async () => ({ gistId: "twoyes" });

  const result = await runShare([contentHash, "--skip-redaction"], {
    storeRoot,
    confirm,
    gistUpload,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("WARNING");
  expect(result.stderr).toContain("--skip-redaction");
  expect(confirmCalls).toHaveLength(2);
  expect(result.stdout).toContain("https://agent-trail.dev/view/gist/twoyes");
  expect(result.stdout).not.toContain("Redaction summary:\n");
});

test("--skip-redaction --yes uploads raw registered object bytes", async () => {
  const fakeKey = `sk-${"A".repeat(40)}`;
  const { contentHash } = await seedRegistered({ text: `please use key ${fakeKey} now` });
  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "rawid" };
  };

  const result = await runShare([contentHash, "--skip-redaction", "--yes"], {
    storeRoot,
    confirm: async () => true,
    gistUpload,
  });

  expect(result.exitCode).toBe(0);
  expect(captured).not.toBeNull();
  const decoded = decodePayload(captured as unknown as Uint8Array);
  expect(decoded).toContain(fakeKey);
  expect(decoded).toContain(contentHash);
});

test("upload filename sorts after the extensionless metadata title file", async () => {
  const { contentHash } = await seedRegistered();
  const captured: { filename?: string } = {};
  const gistUpload = async (_payload: Uint8Array, filename: string) => {
    captured.filename = filename;
    return { gistId: "fnid" };
  };

  const result = await runShare([contentHash, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(captured.filename).toBe(`trail-${contentHash.slice(0, 12)}.trail.jsonl.gz.b64`);
});

test("upload receives gist metadata for title file and preview description", async () => {
  const { contentHash } = await seedRegistered();
  const captured: {
    filename?: string;
    metadata?: Parameters<NonNullable<RunShareContext["gistUpload"]>>[2];
  } = {};
  const gistUpload: NonNullable<RunShareContext["gistUpload"]> = async (
    _payload,
    filename,
    metadata,
  ) => {
    captured.filename = filename;
    captured.metadata = metadata;
    return { gistId: "metaid" };
  };

  const result = await runShare([contentHash, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(captured.filename).toBe(`trail-${contentHash.slice(0, 12)}.trail.jsonl.gz.b64`);
  expect(captured.metadata).toEqual({
    contentHash,
    metadataFilename: `trail-${contentHash.slice(0, 12)}`,
    payloadHash: contentHash,
    redactionSkipped: false,
    title: `Agent Trail share: ${contentHash.slice(0, 12)}`,
    viewerBaseUrl: "https://agent-trail.dev/view/gist",
  });
});

test("gist metadata update warning does not fail a shared upload", async () => {
  const { contentHash } = await seedRegistered();
  const gistUpload = async () => ({
    gistId: "warnid",
    warning: "gist metadata update failed: edit failed",
  });

  const result = await runShare([contentHash, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("WARNING: gist metadata update failed: edit failed");
  expect(result.stdout).toContain("https://agent-trail.dev/view/gist/warnid");
});

test("gistUpload failure: exit 1, stderr contains error and gh auth hint, no viewer URL", async () => {
  const { contentHash } = await seedRegistered();
  const gistUpload = async () => {
    throw new Error("gh: command not found");
  };

  const result = await runShare([contentHash, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("gh: command not found");
  expect(result.stderr).toContain("gh auth login");
  expect(result.stdout).not.toContain("view/gist/");
});

test("upload payload is gzipped base64 of the redacted JSONL", async () => {
  const fakeKey = `sk-${"A".repeat(40)}`;
  const { contentHash } = await seedRegistered({ text: `please use key ${fakeKey} now` });
  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "payloadid" };
  };

  const result = await runShare([contentHash, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(captured).not.toBeNull();
  const decoded = decodePayload(captured as unknown as Uint8Array);
  expect(decoded).not.toContain(fakeKey);
  const records = await parseJsonlString(decoded);
  expect(records.length).toBeGreaterThanOrEqual(2);
  expect(records[0]?.value.type).toBe("session");
});

test("upload payload of redacted-with-secrets trail has a finalized content_hash", async () => {
  const fakeKey = `sk-${"A".repeat(40)}`;
  const { contentHash } = await seedRegistered({ text: `please use key ${fakeKey} now` });
  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "hashid" };
  };

  const result = await runShare([contentHash, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  const decoded = decodePayload(captured as unknown as Uint8Array);
  const records = await parseJsonlString(decoded);
  const verification = verifyContentHash(records);
  expect(verification.status).toBe("match");
});

test("redaction summary reports counts for secrets in trail payload", async () => {
  const fakeKey = `sk-${"A".repeat(40)}`;
  const { contentHash } = await seedRegistered({ text: `please use key ${fakeKey} now` });

  const result = await runShare([contentHash, "--dry-run"], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Redaction summary");
  expect(result.stdout).toMatch(/openai_api_key:\s*\d+/);
  expect(result.stdout).not.toContain(fakeKey);
});

test("--dry-run: registers, prints summary, no confirm, no upload", async () => {
  const { contentHash } = await seedRegistered();
  let confirmCalled = false;
  const confirm = async (): Promise<boolean> => {
    confirmCalled = true;
    return true;
  };
  let uploadCalled = false;
  const gistUpload = async () => {
    uploadCalled = true;
    return { gistId: "should-not-happen" };
  };

  const result = await runShare([contentHash, "--dry-run"], { storeRoot, confirm, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(confirmCalled).toBe(false);
  expect(uploadCalled).toBe(false);
  expect(result.stdout).toContain("Redaction summary");
  expect(result.stdout).not.toContain("view/gist/");
});

test("--yes bypasses confirmation and prints viewer URL", async () => {
  const { contentHash } = await seedRegistered();
  let confirmCalled = false;
  const confirm = async (): Promise<boolean> => {
    confirmCalled = true;
    return false;
  };
  const gistUpload = async () => ({ gistId: "yesid" });

  const result = await runShare([contentHash, "--yes"], { storeRoot, confirm, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(confirmCalled).toBe(false);
  expect(result.stdout).toContain("https://agent-trail.dev/view/gist/yesid");
});

test("non-TTY default confirm: throws are caught, cancels with actionable hint to use --yes", async () => {
  const { contentHash } = await seedRegistered();
  const confirm = async (): Promise<boolean> => {
    throw new ReferenceError("prompt is not defined");
  };

  const result = await runShare([contentHash], { storeRoot, confirm });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Share cancelled");
  expect(result.stderr).toContain("--yes");
});

test("normal mode, confirm declined: exits 0 with Share cancelled and no upload", async () => {
  const { contentHash } = await seedRegistered();
  const confirm = async (): Promise<boolean> => false;
  let uploadCalled = false;
  const gistUpload = async () => {
    uploadCalled = true;
    return { gistId: "should-not-happen" };
  };

  const result = await runShare([contentHash], { storeRoot, confirm, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(uploadCalled).toBe(false);
  expect(result.stdout).toContain("Share cancelled");
  expect(result.stdout).not.toContain("view/gist/");
});

test("default share strips repository identity from uploaded gist and counts it in the summary", async () => {
  const remoteUrl = "https://github.com/agent-trail/agent-trail";
  const { contentHash } = await seedRegistered({
    vcs: { type: "git", revision: "a1b2c3d4", remote_url: remoteUrl },
    extraRecords: [
      {
        type: "system_event",
        id: "01HEVTA0000000000000000002",
        ts: "2026-05-17T14:00:06.000Z",
        payload: {
          kind: "vcs_commit",
          data: {
            sha: "a1b2c3d",
            tool_call_id: "01HEVTA0000000000000000003",
            repo: remoteUrl,
          },
        },
      },
    ],
  });
  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "strip-id" };
  };

  const result = await runShare([contentHash, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).not.toContain("--keep-remote-url");
  expect(result.stdout).toContain("vcs_remote_url: 2");
  expect(captured).not.toBeNull();
  const decoded = decodePayload(captured as unknown as Uint8Array);
  expect(decoded).not.toContain(remoteUrl);
});

test("--keep-remote-url preserves repository identity in the uploaded gist, emits a warning, and suppresses the summary count", async () => {
  const remoteUrl = "https://github.com/agent-trail/agent-trail";
  const { contentHash } = await seedRegistered({
    vcs: { type: "git", revision: "a1b2c3d4", remote_url: remoteUrl },
    extraRecords: [
      {
        type: "system_event",
        id: "01HEVTA0000000000000000002",
        ts: "2026-05-17T14:00:06.000Z",
        payload: {
          kind: "vcs_commit",
          data: {
            sha: "a1b2c3d",
            tool_call_id: "01HEVTA0000000000000000003",
            repo: remoteUrl,
          },
        },
      },
    ],
  });
  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "keep-id" };
  };

  const result = await runShare([contentHash, "--keep-remote-url", "--yes"], {
    storeRoot,
    gistUpload,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("WARNING: --keep-remote-url");
  expect(result.stderr).toContain("vcs_commit repo data");
  expect(result.stdout).not.toContain("vcs_remote_url");
  expect(captured).not.toBeNull();
  const decoded = decodePayload(captured as unknown as Uint8Array);
  expect(decoded).toContain(remoteUrl);
});

test("trail with envelope: shared payload carries both session and envelope content_hash", async () => {
  // Seed a trail file that begins with a trail envelope followed by a session
  // header. Both records should end up with a finalized content_hash that
  // verifies against the shared bytes.
  const envelope: Record<string, unknown> = {
    type: "trail",
    schema_version: "0.1.0",
    id: "01HTR1SHARE0000000000000A1",
    ts: "2026-05-17T14:00:00.000Z",
    producer: "trail-cli/0.3.0",
  };
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS000000000000SHARE00",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
    cwd: "/work/proj-a",
  };
  const userMsg = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hello" },
  };
  const draftBytes = `${JSON.stringify(envelope)}\n${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`;
  const draftRecords = await parseJsonlString(draftBytes);
  const sessionHash = computeContentHash(draftRecords);
  header.content_hash = sessionHash;
  const stamped = await parseJsonlString(
    `${JSON.stringify(envelope)}\n${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`,
  );
  const envelopeHash = computeTrailEnvelopeContentHash(stamped);
  envelope.content_hash = envelopeHash;
  const finalBytes = canonicalizeRecords(
    await parseJsonlString(
      `${JSON.stringify(envelope)}\n${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`,
    ),
  );

  const dir = mkdtempSync(join(tmpdir(), "trail-cli-share-envelope-"));
  const filePath = join(dir, "session.trail.jsonl");
  await writeFile(filePath, finalBytes, "utf8");
  const reg = await registerTrail(filePath, { storeRoot });
  if (reg.contentHash === null) throw new Error(`seed register failed: ${reg.status}`);

  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "envelopeid" };
  };

  const result = await runShare([reg.contentHash, "--yes"], { storeRoot, gistUpload });

  if (result.exitCode !== 0) {
    throw new Error(`share failed: ${result.stderr}`);
  }
  expect(captured).not.toBeNull();
  const decoded = decodePayload(captured as unknown as Uint8Array);
  const sharedRecords = await parseJsonlString(decoded);
  expect(sharedRecords[0]?.value.type).toBe("trail");
  expect(sharedRecords[1]?.value.type).toBe("session");
  expect(verifyContentHash(sharedRecords).status).toBe("match");
  expect(verifyTrailEnvelopeContentHash(sharedRecords).status).toBe("match");
});

test("multi-session session hash shares only the selected session group", async () => {
  const records = [
    {
      line: 1,
      raw: "",
      value: {
        type: "trail",
        schema_version: "0.1.0",
        id: "01HTRA0X00000000000000S001",
        ts: "2026-05-17T14:00:00.000Z",
        producer: "trail-cli/0.3.0",
      },
    },
    {
      line: 2,
      raw: "",
      value: {
        type: "session",
        schema_version: "0.1.0",
        id: "01HSESS0000000000000000S01",
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "codex-cli" },
      },
    },
    {
      line: 3,
      raw: "",
      value: {
        type: "user_message",
        id: "01HEVTS0000000000000000S01",
        ts: "2026-05-17T14:00:05.000Z",
        payload: { text: "first session should not upload" },
      },
    },
    {
      line: 4,
      raw: "",
      value: {
        type: "session",
        schema_version: "0.1.0",
        id: "01HSESS0000000000000000S02",
        ts: "2026-05-17T14:05:00.000Z",
        agent: { name: "claude-code" },
      },
    },
    {
      line: 5,
      raw: "",
      value: {
        type: "user_message",
        id: "01HEVTS0000000000000000S02",
        ts: "2026-05-17T14:05:05.000Z",
        payload: { text: "second session should upload" },
      },
    },
  ];
  const stamped = stampTrail(records);
  const dir = mkdtempSync(join(tmpdir(), "trail-cli-share-ms-"));
  const filePath = join(dir, "multi.trail.jsonl");
  await writeFile(filePath, canonicalizeRecords(records), "utf8");
  await registerTrail(filePath, { storeRoot });
  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "sessionhashid" };
  };

  const result = await runShare([stamped.sessionHashes[1] as string, "--yes"], {
    storeRoot,
    gistUpload,
  });

  expect(result.exitCode).toBe(0);
  expect(captured).not.toBeNull();
  const decoded = decodePayload(captured as unknown as Uint8Array);
  const sharedRecords = await parseJsonlString(decoded);
  expect(sharedRecords.map((record) => record.value.type)).toEqual(["session", "user_message"]);
  expect(sharedRecords[0]?.value.id).toBe("01HSESS0000000000000000S02");
  expect(decoded).toContain("second session should upload");
  expect(decoded).not.toContain("first session should not upload");
  expect(verifyContentHash(sharedRecords).status).toBe("match");

  captured = null;
  const rawResult = await runShare(
    [stamped.sessionHashes[1] as string, "--skip-redaction", "--yes"],
    {
      storeRoot,
      confirm: async () => true,
      gistUpload,
    },
  );

  expect(rawResult.exitCode).toBe(0);
  expect(captured).not.toBeNull();
  const decodedRaw = decodePayload(captured as unknown as Uint8Array);
  const sharedRawRecords = await parseJsonlString(decodedRaw);
  expect(sharedRawRecords.map((record) => record.value.type)).toEqual(["session", "user_message"]);
  expect(sharedRawRecords[0]?.value.id).toBe("01HSESS0000000000000000S02");
  expect(decodedRaw).toContain("second session should upload");
  expect(decodedRaw).not.toContain("first session should not upload");
  expect(verifyContentHash(sharedRawRecords).status).toBe("match");

  rmSync(dir, { recursive: true, force: true });
});

test("short prefix: unique index match resolves to full hash", async () => {
  const { contentHash } = await seedRegistered();
  const prefix = contentHash.slice(0, 12);
  const gistUpload = async () => ({ gistId: "prefixid" });

  const result = await runShare([prefix, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(contentHash);
  expect(result.stdout).toContain("https://agent-trail.dev/view/gist/prefixid");
});

test("--json short prefix with missing object emits unknown id error", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const hash = `facefeed${"a".repeat(56)}`;
  const indexDir = join(storeRoot, "index");
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(
    join(indexDir, "objects.json"),
    `${JSON.stringify(
      {
        version: 1,
        entries: {
          [hash]: { registered_at: "2026-05-17T14:00:00.000Z", source_path: null },
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runShare(["facefeed", "--json"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("share: unknown id: facefeed");
  expect(JSON.parse(result.stdout)).toEqual({
    status: "error",
    content_hash: null,
    redaction: null,
    copied: false,
    error: { message: "share: unknown id: facefeed" },
  });
});

test("short prefix: ambiguous match exits 1 and lists candidates", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const hashA = `deadbeef${"a".repeat(56)}`;
  const hashB = `deadbeef${"b".repeat(56)}`;
  const indexDir = join(storeRoot, "index");
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(
    join(indexDir, "objects.json"),
    `${JSON.stringify(
      {
        version: 1,
        entries: {
          [hashA]: { registered_at: "2026-05-17T14:00:00.000Z", source_path: null },
          [hashB]: { registered_at: "2026-05-17T14:00:00.000Z", source_path: null },
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runShare(["deadbeef", "--dry-run"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("share: ambiguous id: deadbeef");
  expect(result.stderr).toContain(hashA);
  expect(result.stderr).toContain(hashB);
});

test("--json short prefix ambiguous match emits parseable error object", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const hashA = `deadbeef${"a".repeat(56)}`;
  const hashB = `deadbeef${"b".repeat(56)}`;
  const indexDir = join(storeRoot, "index");
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(
    join(indexDir, "objects.json"),
    `${JSON.stringify(
      {
        version: 1,
        entries: {
          [hashA]: { registered_at: "2026-05-17T14:00:00.000Z", source_path: null },
          [hashB]: { registered_at: "2026-05-17T14:00:00.000Z", source_path: null },
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runShare(["deadbeef", "--json"], { storeRoot });

  expect(result.exitCode).toBe(1);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.status).toBe("error");
  expect(parsed.error.message).toContain("share: ambiguous id: deadbeef");
  expect(parsed.error.message).toContain(hashA);
  expect(parsed.error.message).toContain(hashB);
});

test("--json dry-run emits stable object shape", async () => {
  const { contentHash } = await seedRegistered();

  const result = await runShare([contentHash, "--dry-run", "--json"], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    status: "dry_run",
    content_hash: contentHash,
    redaction: { skipped: false, summary: { counts: {} } },
    redacted_content_hash: contentHash,
    copied: false,
  });
});

test("--json redaction summary omits secret samples", async () => {
  const fakeKey = `sk-${"A".repeat(40)}`;
  const { contentHash } = await seedRegistered({ text: `please use key ${fakeKey} now` });

  const result = await runShare([contentHash, "--dry-run", "--json"], { storeRoot });

  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.redaction.summary).toEqual({ counts: { openai_api_key: 1 } });
  expect(result.stdout).not.toContain("samples");
  expect(result.stdout).not.toContain("sk-");
  expect(result.stdout).not.toContain("AAAA");
});

test("--json shared emits gist fields and URL", async () => {
  const { contentHash } = await seedRegistered();
  const gistUpload = async () => ({ gistId: "jsonid" });

  const result = await runShare([contentHash, "--yes", "--json"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    status: "shared",
    content_hash: contentHash,
    redaction: { skipped: false, summary: { counts: {} } },
    redacted_content_hash: contentHash,
    gist_id: "jsonid",
    url: "https://agent-trail.dev/view/gist/jsonid",
    copied: false,
  });
});

test("--json cancelled emits status without uploading", async () => {
  const { contentHash } = await seedRegistered();
  let uploadCalled = false;
  const gistUpload = async () => {
    uploadCalled = true;
    return { gistId: "nope" };
  };

  const result = await runShare([contentHash, "--json"], {
    storeRoot,
    confirm: async () => false,
    gistUpload,
  });

  expect(result.exitCode).toBe(0);
  expect(uploadCalled).toBe(false);
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: "cancelled",
    content_hash: contentHash,
    copied: false,
  });
});

test("--json upload failure emits stable failure object and gh auth hint", async () => {
  const { contentHash } = await seedRegistered();
  const gistUpload = async () => {
    throw new Error("gh: command not found");
  };

  const result = await runShare([contentHash, "--yes", "--json"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("gh auth login");
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: "upload_failed",
    content_hash: contentHash,
    copied: false,
  });
});
