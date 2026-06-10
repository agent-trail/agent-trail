import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";

import {
  buildGistViewerModel,
  fetchGistPayloadFromGitHub,
  GIST_VIEWER_LIMITS,
} from "./gist-viewer.ts";
import { seedSharedTrailPayload, seedSharedTrailRecords } from "./test-support.ts";

test("gist viewer model loads a valid shared trail through the injected gist fetcher", async () => {
  const seed = await seedSharedTrailPayload();

  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async (gistId) => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: `https://gist.githubusercontent.com/${gistId}/raw/${seed.filename}`,
    }),
  });

  expect(model.gistId).toBe("abc123def4567890abcd");
  expect(model.title).toBe("Trail viewer");
  expect(model.status).toBe("loaded");
  if (model.status !== "loaded") throw new Error("expected loaded model");
  expect(model.filename).toBe(seed.filename);
  expect(model.contentHash).toBe(seed.contentHash);
  expect(model.diagnostics).toEqual([]);
  expect(model.summary).toEqual({
    records: 2,
    sessions: 1,
    warnings: 0,
  });
  expect(model.events).toEqual([
    expect.objectContaining({
      body: "hello from shared trail",
      kind: "user",
      line: 2,
      title: "User message",
      type: "user_message",
    }),
  ]);
  expect(model.preview).toContain("hello from shared trail");
});

test("gist viewer model exposes renderable core events", async () => {
  const seed = await seedSharedTrailRecords([
    {
      type: "user_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "Render this trail" },
    },
    {
      type: "agent_message",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-17T14:00:06.000Z",
      payload: { text: "I will inspect it.", model: "gpt-5" },
    },
    {
      type: "agent_thinking",
      id: "01HEVTA0000000000000000008",
      ts: "2026-05-17T14:00:06.500Z",
      payload: { text: "Need to inspect README first.", model: "gpt-5", level: "medium" },
    },
    {
      type: "tool_call",
      id: "01HEVTA0000000000000000003",
      ts: "2026-05-17T14:00:07.000Z",
      payload: { tool: "file_read", args: { path: "README.md" } },
    },
    {
      type: "tool_result",
      id: "01HEVTA0000000000000000004",
      ts: "2026-05-17T14:00:08.000Z",
      payload: { for_id: "01HEVTA0000000000000000003", ok: true, output: "Agent Trail" },
    },
    {
      type: "session_summary",
      id: "01HEVTA0000000000000000005",
      ts: "2026-05-17T14:00:09.000Z",
      payload: { scope: "session", text: "Viewer rendered the trail." },
    },
    {
      type: "branch_point",
      id: "01HEVTA0000000000000000006",
      ts: "2026-05-17T14:00:10.000Z",
      payload: { from_id: "01HEVTA0000000000000000002", reason: "Try alternate render" },
    },
    {
      type: "branch_summary",
      id: "01HEVTA0000000000000000007",
      ts: "2026-05-17T14:00:11.000Z",
      payload: {
        abandoned_branch_id: "01HEVTA0000000000000000006",
        summary: "Alternate render abandoned.",
      },
    },
  ]);

  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/core-events",
    }),
  });

  expect(model.status).toBe("loaded");
  if (model.status !== "loaded") throw new Error("expected loaded model");
  expect(model.events.map((event) => event.kind)).toEqual([
    "user",
    "agent",
    "agent",
    "tool_call",
    "tool_result",
    "summary",
    "notice",
    "notice",
  ]);
  expect(model.events.map((event) => event.title)).toEqual([
    "User message",
    "Agent message",
    "Agent thinking",
    "Tool call: file_read",
    "Tool result: ok",
    "Session summary",
    "Branch point",
    "Branch summary",
  ]);
  expect(model.events[2]?.body).toBe("Need to inspect README first.");
  expect(model.events[2]?.meta).toContainEqual({ label: "level", value: "medium" });
  expect(model.events[3]?.meta).toContainEqual({ label: "path", value: "README.md" });
  expect(model.events[4]?.body).toBe("Agent Trail");
  expect(model.events[6]?.body).toBe("Try alternate render");
  expect(model.events[7]?.body).toBe("Alternate render abandoned.");
});

test("gist viewer model preserves unknown records as fallback events", async () => {
  const seed = await seedSharedTrailRecords([
    {
      type: "future_event",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "future shape" },
    },
  ]);

  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/future",
    }),
  });

  expect(model.status).toBe("loaded");
  if (model.status !== "loaded") throw new Error("expected loaded model");
  expect(model.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "reader_tolerant_unknown_record",
      severity: "warning",
    }),
  );
  expect(model.events).toEqual([
    expect.objectContaining({
      kind: "fallback",
      rawJson: expect.stringContaining('"future_event"'),
      title: "Unknown record: future_event",
      type: "future_event",
    }),
  ]);
});

test("gist viewer model keeps hash mismatches as warnings", async () => {
  const seed = await seedSharedTrailPayload({ overrideHash: "0".repeat(64) });

  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/hash-mismatch",
    }),
  });

  expect(model.status).toBe("loaded");
  if (model.status !== "loaded") throw new Error("expected loaded model");
  expect(model.summary.warnings).toBe(1);
  expect(model.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "content_hash_mismatch",
      severity: "warning",
    }),
  );
});

test("gist viewer model turns fetch and decode failures into error state", async () => {
  const fetchFailure = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => {
      throw new Error("not found");
    },
  });

  expect(fetchFailure).toEqual({
    title: "Trail viewer",
    status: "error",
    gistId: "abc123def4567890abcd",
    message: "Failed to fetch gist payload: not found",
    diagnostics: [],
  });

  const decodeFailure = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: "broken.trail.jsonl.gz.b64",
      payloadText: "not-base64-gzip",
      sourceUrl: "https://gist.githubusercontent.com/raw/broken",
    }),
  });

  expect(decodeFailure.status).toBe("error");
  if (decodeFailure.status !== "error") throw new Error("expected error model");
  expect(decodeFailure.message).toContain("Failed to decode shared trail payload");
});

test("gist viewer model rejects non-gist ids without fetching", async () => {
  let fetchCalled = false;

  const model = await buildGistViewerModel({
    gistId: "example",
    fetchGistPayload: async () => {
      fetchCalled = true;
      throw new Error("should not fetch");
    },
  });

  expect(model).toEqual({
    title: "Trail viewer",
    status: "error",
    gistId: "example",
    message: "Unsupported gist id: expected 20-32 lowercase hex characters.",
    diagnostics: [],
  });
  expect(fetchCalled).toBe(false);
});

test("gist viewer model turns invalid trail content into error state with diagnostics", async () => {
  const invalidJsonl = '{"type":"session","schema_version":"0.1.0"}\n';
  const invalidPayloadText = gzipSync(Buffer.from(invalidJsonl, "utf8")).toString("base64");

  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: "invalid.trail.jsonl.gz.b64",
      payloadText: invalidPayloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/invalid",
    }),
  });

  expect(model.status).toBe("error");
  if (model.status !== "error") throw new Error("expected error model");
  expect(model.message).toBe("Shared trail failed reader-tolerant validation.");
  expect(model.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
});

test("gist viewer model turns malformed JSONL into error state with diagnostics", async () => {
  const malformedPayloadText = gzipSync(Buffer.from('{"type":"session"\n', "utf8")).toString(
    "base64",
  );

  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: "malformed.trail.jsonl.gz.b64",
      payloadText: malformedPayloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/malformed",
    }),
  });

  expect(model.status).toBe("error");
  if (model.status !== "error") throw new Error("expected error model");
  expect(model.message).toContain("Shared trail contains invalid JSONL");
  expect(model.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "invalid_jsonl",
      line: 1,
      severity: "error",
    }),
  );
});

test("gist viewer model rejects graph-invalid duplicate ids", async () => {
  const header = {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
  };
  const first = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "first" },
  };
  const duplicate = {
    type: "agent_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:06.000Z",
    payload: { text: "duplicate" },
  };
  const payloadText = gzipSync(
    Buffer.from(
      `${JSON.stringify(header)}\n${JSON.stringify(first)}\n${JSON.stringify(duplicate)}\n`,
    ),
  ).toString("base64");

  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: "duplicate.trail.jsonl.gz.b64",
      payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/duplicate",
    }),
  });

  expect(model.status).toBe("error");
  if (model.status !== "error") throw new Error("expected error model");
  expect(model.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "duplicate_id",
      line: 3,
      severity: "error",
    }),
  );
});

test("gist viewer model rejects oversized compressed and decoded payloads", async () => {
  const oversizedBase64 = "A".repeat(GIST_VIEWER_LIMITS.maxBase64Chars + 1);
  const compressedFailure = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: "large.trail.jsonl.gz.b64",
      payloadText: oversizedBase64,
      sourceUrl: "https://gist.githubusercontent.com/raw/large",
    }),
  });

  expect(compressedFailure.status).toBe("error");
  if (compressedFailure.status !== "error") throw new Error("expected error model");
  expect(compressedFailure.message).toContain("payload exceeds");

  const oversizedCompressed = Buffer.alloc(GIST_VIEWER_LIMITS.maxCompressedBytes + 1).toString(
    "base64",
  );
  const compressedBytesFailure = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: "compressed-large.trail.jsonl.gz.b64",
      payloadText: oversizedCompressed,
      sourceUrl: "https://gist.githubusercontent.com/raw/compressed-large",
    }),
  });

  expect(compressedBytesFailure.status).toBe("error");
  if (compressedBytesFailure.status !== "error") throw new Error("expected error model");
  expect(compressedBytesFailure.message).toContain("compressed payload exceeds");

  const largeDecoded = gzipSync(Buffer.from("a".repeat(GIST_VIEWER_LIMITS.maxDecodedBytes + 1)));
  const decodedFailure = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: "zip-bomb.trail.jsonl.gz.b64",
      payloadText: largeDecoded.toString("base64"),
      sourceUrl: "https://gist.githubusercontent.com/raw/zip-bomb",
    }),
  });

  expect(decodedFailure.status).toBe("error");
  if (decodedFailure.status !== "error") throw new Error("expected error model");
  expect(decodedFailure.message).toContain("decoded payload exceeds");
});

test("gist viewer model returns a bounded preview for large valid trails", async () => {
  const seed = await seedSharedTrailPayload({ text: "x".repeat(90_000) });

  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/large-valid",
    }),
  });

  expect(model.status).toBe("loaded");
  if (model.status !== "loaded") throw new Error("expected loaded model");
  expect(model.previewBytes).toBeGreaterThan(GIST_VIEWER_LIMITS.maxPreviewBytes);
  expect(model.previewTruncated).toBe(true);
  expect(model.preview.length).toBeLessThan(model.previewBytes);
});

test("github gist payload fetcher selects the single shared payload file", async () => {
  const seed = await seedSharedTrailPayload();
  const calls: string[] = [];
  const signals: unknown[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const href = String(url);
    calls.push(href);
    signals.push(init?.signal);
    if (href.includes("api.github.com")) {
      return Response.json({
        files: {
          "notes.md": {
            filename: "notes.md",
            raw_url: "https://gist.githubusercontent.com/raw/notes",
          },
          [seed.filename]: {
            filename: seed.filename,
            raw_url: "https://gist.githubusercontent.com/raw/trail",
          },
        },
      });
    }
    return new Response(seed.payloadText);
  };

  const payload = await fetchGistPayloadFromGitHub("abc123def4567890abcd", fetchImpl);

  expect(payload).toEqual({
    filename: seed.filename,
    payloadText: seed.payloadText,
    sourceUrl: "https://gist.githubusercontent.com/raw/trail",
  });
  expect(calls).toEqual([
    "https://api.github.com/gists/abc123def4567890abcd",
    "https://gist.githubusercontent.com/raw/trail",
  ]);
  expect(signals).toHaveLength(2);
  for (const signal of signals) {
    expect(signal).toBeInstanceOf(AbortSignal);
  }
});

test("github gist payload fetcher rejects missing, duplicate, and raw fetch failures", async () => {
  const missing = async (): Promise<Response> => Response.json({ files: {} });
  await expect(fetchGistPayloadFromGitHub("abc123def4567890abcd", missing)).rejects.toThrow(
    "expected exactly one .trail.jsonl.gz.b64 file, found 0",
  );

  const duplicate = async (): Promise<Response> =>
    Response.json({
      files: {
        a: {
          filename: "a.trail.jsonl.gz.b64",
          raw_url: "https://gist.githubusercontent.com/raw/a",
        },
        b: {
          filename: "b.trail.jsonl.gz.b64",
          raw_url: "https://gist.githubusercontent.com/raw/b",
        },
      },
    });
  await expect(fetchGistPayloadFromGitHub("abc123def4567890abcd", duplicate)).rejects.toThrow(
    "expected exactly one .trail.jsonl.gz.b64 file, found 2",
  );

  const rawFailure = async (url: string | URL | Request): Promise<Response> => {
    const href = String(url);
    if (href.includes("api.github.com")) {
      return Response.json({
        files: {
          payload: {
            filename: "payload.trail.jsonl.gz.b64",
            raw_url: "https://gist.githubusercontent.com/raw/payload",
          },
        },
      });
    }
    return new Response("missing", { status: 404, statusText: "Not Found" });
  };
  await expect(fetchGistPayloadFromGitHub("abc123def4567890abcd", rawFailure)).rejects.toThrow(
    "GitHub raw payload returned 404 Not Found",
  );
});

test("github gist payload fetcher bounds metadata before parsing raw payloads", async () => {
  const oversizedMetadata = async (): Promise<Response> =>
    new Response(" ".repeat(GIST_VIEWER_LIMITS.maxMetadataChars + 1));
  await expect(
    fetchGistPayloadFromGitHub("abc123def4567890abcd", oversizedMetadata),
  ).rejects.toThrow(`payload exceeds ${GIST_VIEWER_LIMITS.maxMetadataChars} characters`);

  const tooManyFiles = async (): Promise<Response> =>
    Response.json({
      files: Object.fromEntries(
        Array.from({ length: GIST_VIEWER_LIMITS.maxMetadataFiles + 1 }, (_, index) => [
          `file-${index}.txt`,
          {
            filename: `file-${index}.txt`,
            raw_url: `https://gist.githubusercontent.com/raw/${index}`,
          },
        ]),
      ),
    });
  await expect(fetchGistPayloadFromGitHub("abc123def4567890abcd", tooManyFiles)).rejects.toThrow(
    `gist metadata lists more than ${GIST_VIEWER_LIMITS.maxMetadataFiles} files`,
  );

  const declaredTooLarge = async (): Promise<Response> =>
    Response.json({
      files: {
        payload: {
          filename: "payload.trail.jsonl.gz.b64",
          raw_url: "https://gist.githubusercontent.com/raw/payload",
          size: GIST_VIEWER_LIMITS.maxBase64Chars + 1,
        },
      },
    });
  await expect(
    fetchGistPayloadFromGitHub("abc123def4567890abcd", declaredTooLarge),
  ).rejects.toThrow(`declared payload size exceeds ${GIST_VIEWER_LIMITS.maxBase64Chars} bytes`);
});

test("github gist payload fetcher reports aborted requests as timeouts", async () => {
  const aborted = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    throw new DOMException("aborted", "AbortError");
  };

  await expect(fetchGistPayloadFromGitHub("abc123def4567890abcd", aborted)).rejects.toThrow(
    `GitHub request timed out after ${GIST_VIEWER_LIMITS.fetchTimeoutMs}ms`,
  );
});
