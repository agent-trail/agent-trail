import { gunzipSync } from "node:zlib";
import {
  type Diagnostic,
  parseJsonlString,
  splitSessionGroups,
  validateTrailString,
} from "@agent-trail/core";

export type GistViewerModel =
  | {
      title: "Trail viewer";
      status: "loaded";
      gistId: string;
      filename: string;
      sourceUrl: string;
      contentHash: string | null;
      diagnostics: Diagnostic[];
      summary: {
        records: number;
        sessions: number;
        warnings: number;
      };
      preview: string;
    }
  | {
      title: "Trail viewer";
      status: "error";
      gistId: string;
      message: string;
      diagnostics: Diagnostic[];
    };

export type GistPayload = {
  filename: string;
  payloadText: string;
  sourceUrl: string;
};

export type FetchGistPayload = (gistId: string) => Promise<GistPayload>;

const GIST_ID_RE = /^[0-9a-f]{20,32}$/;

export async function buildGistViewerModel({
  gistId,
  fetchGistPayload = fetchGistPayloadFromGitHub,
}: {
  gistId: string;
  fetchGistPayload?: FetchGistPayload;
}): Promise<GistViewerModel> {
  if (!GIST_ID_RE.test(gistId)) {
    return viewerError(gistId, "Unsupported gist id: expected 20-32 lowercase hex characters.");
  }

  let fetched: GistPayload;
  try {
    fetched = await fetchGistPayload(gistId);
  } catch (error) {
    return viewerError(gistId, `Failed to fetch gist payload: ${errorMessage(error)}`);
  }

  let jsonl: string;
  try {
    jsonl = decodeSharedTrailPayload(fetched.payloadText);
  } catch (error) {
    return viewerError(gistId, `Failed to decode shared trail payload: ${errorMessage(error)}`);
  }

  const diagnostics = await validateTrailString(jsonl, { profile: "reader-tolerant" });
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    return {
      title: "Trail viewer",
      status: "error",
      gistId,
      message: "Shared trail failed reader-tolerant validation.",
      diagnostics,
    };
  }

  const records = await parseJsonlString(jsonl);
  const split = splitSessionGroups(records);
  const header = split.groups[0]?.header.value as { content_hash?: unknown } | undefined;
  return {
    title: "Trail viewer",
    status: "loaded",
    gistId,
    filename: fetched.filename,
    sourceUrl: fetched.sourceUrl,
    contentHash: typeof header?.content_hash === "string" ? header.content_hash : null,
    diagnostics,
    summary: {
      records: records.length,
      sessions: split.groups.length,
      warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
    },
    preview: jsonl,
  };
}

async function fetchGistPayloadFromGitHub(gistId: string): Promise<GistPayload> {
  const response = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} ${response.statusText}`);
  }
  const value = (await response.json()) as {
    files?: Record<string, { filename?: string; raw_url?: string | null } | null>;
  };
  const files = Object.values(value.files ?? {}).filter(
    (file): file is { filename: string; raw_url: string } =>
      typeof file?.filename === "string" &&
      file.filename.endsWith(".trail.jsonl.gz.b64") &&
      typeof file.raw_url === "string",
  );
  if (files.length !== 1) {
    throw new Error(`expected exactly one .trail.jsonl.gz.b64 file, found ${files.length}`);
  }
  const file = files[0] as { filename: string; raw_url: string };
  const raw = await fetch(file.raw_url);
  if (!raw.ok) {
    throw new Error(`GitHub raw payload returned ${raw.status} ${raw.statusText}`);
  }
  return {
    filename: file.filename,
    payloadText: (await raw.text()).trim(),
    sourceUrl: file.raw_url,
  };
}

function decodeSharedTrailPayload(payloadText: string): string {
  return gunzipSync(Buffer.from(payloadText.trim(), "base64")).toString("utf8");
}

function viewerError(gistId: string, message: string): GistViewerModel {
  return {
    title: "Trail viewer",
    status: "error",
    gistId,
    message,
    diagnostics: [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
