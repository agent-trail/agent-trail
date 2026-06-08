import { expect, test } from "bun:test";
import {
  buildGistMetadata,
  gistCreateCommand,
  gistEditMetadataCommand,
  parseGistIdFromGhOutput,
} from "./gist-upload.ts";

test("parseGistIdFromGhOutput: extracts id from typical gh output", () => {
  const stdout = "https://gist.github.com/octocat/abc123\n";
  expect(parseGistIdFromGhOutput(stdout)).toBe("abc123");
});

test("parseGistIdFromGhOutput: extracts id from owner-less gist URL", () => {
  const stdout = "https://gist.github.com/abc123\n";
  expect(parseGistIdFromGhOutput(stdout)).toBe("abc123");
});

test("parseGistIdFromGhOutput: throws on unrecognized output", () => {
  expect(() => parseGistIdFromGhOutput("weird output")).toThrow(
    /gh gist create: unexpected output/,
  );
});

test("buildGistMetadata: emits title metadata before gist id exists", () => {
  expect(
    buildGistMetadata({
      contentHash: "a".repeat(64),
      metadataFilename: "trail-aaaaaaaaaaaa",
      payloadHash: "b".repeat(64),
      redactionSkipped: false,
      title: "Agent Trail share: bbbbbbbbbbbb",
      viewerBaseUrl: "https://agent-trail.dev/view/gist",
    }),
  ).toEqual({
    type: "agent-trail-share",
    title: "Agent Trail share: bbbbbbbbbbbb",
    content_hash: "a".repeat(64),
    shared_content_hash: "b".repeat(64),
    redaction: { skipped: false },
  });
});

test("buildGistMetadata: adds preview link after gist id exists", () => {
  expect(
    buildGistMetadata(
      {
        contentHash: "a".repeat(64),
        metadataFilename: "trail-aaaaaaaaaaaa",
        payloadHash: "b".repeat(64),
        redactionSkipped: true,
        title: "Agent Trail share: bbbbbbbbbbbb",
        viewerBaseUrl: "https://agent-trail.dev/view/gist",
      },
      "abc123",
      "https://agent-trail.dev/view/gist/abc123",
    ),
  ).toMatchObject({
    gist_id: "abc123",
    preview_url: "https://agent-trail.dev/view/gist/abc123",
    redaction: { skipped: true },
  });
});

test("gistCreateCommand: creates metadata file with same prefix so it sorts before payload", () => {
  expect(
    gistCreateCommand("/tmp/trail-abc123", "/tmp/trail-abc123.trail.jsonl.gz.b64", "Title"),
  ).toEqual([
    "gh",
    "gist",
    "create",
    "--public=false",
    "--desc",
    "Title",
    "/tmp/trail-abc123",
    "/tmp/trail-abc123.trail.jsonl.gz.b64",
  ]);
});

test("gistEditMetadataCommand: replaces metadata file and adds preview description", () => {
  expect(
    gistEditMetadataCommand(
      "abc123",
      "trail-abc123",
      "/tmp/trail-abc123",
      "Title | Preview: https://agent-trail.dev/view/gist/abc123",
    ),
  ).toEqual([
    "gh",
    "gist",
    "edit",
    "abc123",
    "--desc",
    "Title | Preview: https://agent-trail.dev/view/gist/abc123",
    "--filename",
    "trail-abc123",
    "/tmp/trail-abc123",
  ]);
});
