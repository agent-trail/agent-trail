import { expect, test } from "bun:test";
import { extractGitCommitEvents, synthesizeVcsCommitEvents } from "./vcs-commit.ts";

test("extractGitCommitEvents parses a successful git commit summary", () => {
  expect(
    extractGitCommitEvents({
      command: 'git add . && git commit -m "fix: ship it"',
      output: "[main A1B2C3D] fix: ship it\n 1 file changed, 1 insertion(+)\n",
      toolCallId: "tool-call-1",
    }),
  ).toEqual([
    {
      sha: "a1b2c3d",
      branch: "main",
      message: "fix: ship it",
      tool_call_id: "tool-call-1",
    },
  ]);
});

test("extractGitCommitEvents parses amended and multiple commit summaries", () => {
  expect(
    extractGitCommitEvents({
      command: 'git commit --amend --no-edit && git commit -m "second"',
      output:
        "[feature/topic deadbee] fix: amend previous\n Date: Thu Jun 11 10:00:00 2026 +0530\n[main cafef00] second\n",
      toolCallId: "tool-call-2",
      repo: "https://github.com/agent-trail/agent-trail",
    }),
  ).toEqual([
    {
      sha: "deadbee",
      branch: "feature/topic",
      message: "fix: amend previous",
      tool_call_id: "tool-call-2",
      repo: "https://github.com/agent-trail/agent-trail",
    },
    {
      sha: "cafef00",
      branch: "main",
      message: "second",
      tool_call_id: "tool-call-2",
      repo: "https://github.com/agent-trail/agent-trail",
    },
  ]);
});

test("extractGitCommitEvents ignores non-commit commands and missing output", () => {
  expect(
    extractGitCommitEvents({
      command: "git status",
      output: 'nothing to commit, use "git commit" to create a commit',
      toolCallId: "tool-call-3",
    }),
  ).toEqual([]);
  expect(
    extractGitCommitEvents({
      command: 'git commit -m "missing output"',
      output: "",
      toolCallId: "tool-call-4",
    }),
  ).toEqual([]);
});

test("synthesizeVcsCommitEvents inserts a vcs_commit after a successful shell result", () => {
  const entries = synthesizeVcsCommitEvents(
    [
      {
        type: "tool_call",
        id: "call-entry",
        ts: "2026-06-11T10:00:00.000Z",
        payload: { tool: "shell_command", args: { command: 'git commit -m "fix: ship it"' } },
        semantic: { call_id: "native-call", tool_kind: "shell_command" },
        source: { agent: "claude-code", original_type: "assistant" },
      },
      {
        type: "tool_result",
        id: "result-entry",
        ts: "2026-06-11T10:00:01.000Z",
        payload: {
          for_id: "call-entry",
          ok: true,
          output: "[main a1b2c3d] fix: ship it\n 1 file changed, 1 insertion(+)\n",
        },
        semantic: { call_id: "native-call", tool_kind: "shell_command" },
        source: { agent: "claude-code", original_type: "user" },
      },
    ],
    {
      idNamespace: "0a16dbc7-c189-4def-f378-95ab1c2d3e45",
      repo: "https://github.com/agent-trail/agent-trail",
    },
  );

  expect(entries.map((entry) => entry.type)).toEqual(["tool_call", "tool_result", "system_event"]);
  expect(entries[2]?.payload).toEqual({
    kind: "vcs_commit",
    data: {
      sha: "a1b2c3d",
      branch: "main",
      message: "fix: ship it",
      tool_call_id: "call-entry",
      repo: "https://github.com/agent-trail/agent-trail",
    },
  });
  expect(entries[2]?.semantic).toEqual({ call_id: "native-call" });
  expect(entries[2]?.source).toEqual({
    agent: "claude-code",
    original_type: "user.vcs_commit",
    synthesized: true,
  });
});

test("synthesizeVcsCommitEvents ignores failed and unlinked shell results", () => {
  expect(
    synthesizeVcsCommitEvents(
      [
        {
          type: "tool_call",
          id: "call-entry",
          ts: "2026-06-11T10:00:00.000Z",
          payload: { tool: "shell_command", args: { command: 'git commit -m "nope"' } },
        },
        {
          type: "tool_result",
          id: "result-entry",
          ts: "2026-06-11T10:00:01.000Z",
          payload: { for_id: "call-entry", ok: false, output: "[main a1b2c3d] nope" },
        },
        {
          type: "tool_result",
          id: "unlinked-result",
          ts: "2026-06-11T10:00:02.000Z",
          payload: { ok: true, output: "[main deadbee] unlinked" },
        },
      ],
      { idNamespace: "0a16dbc7-c189-4def-f378-95ab1c2d3e45" },
    ).filter((entry) => entry.type === "system_event"),
  ).toEqual([]);
});
