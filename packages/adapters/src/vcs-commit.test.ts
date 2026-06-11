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

test("extractGitCommitEvents recognizes git global options and root commits", () => {
  expect(
    extractGitCommitEvents({
      command: 'git -C "$repo" -c user.name=Trail commit -m "init"',
      output: "[master (root-commit) BAE7327] init\n 1 file changed, 1 insertion(+)\n",
      toolCallId: "tool-call-root",
    }),
  ).toEqual([
    {
      sha: "bae7327",
      branch: "master",
      message: "init",
      tool_call_id: "tool-call-root",
    },
  ]);
});

test("extractGitCommitEvents preserves successful empty commit messages", () => {
  expect(
    extractGitCommitEvents({
      command: 'git commit --allow-empty-message -m ""',
      output: "[master (root-commit) 66c7bdf] \n",
      toolCallId: "tool-call-empty-message",
    }),
  ).toEqual([
    {
      sha: "66c7bdf",
      branch: "master",
      message: "",
      tool_call_id: "tool-call-empty-message",
    },
  ]);
});

test("extractGitCommitEvents ignores mentions and ambiguous neighboring commands", () => {
  expect(
    extractGitCommitEvents({
      command: 'echo "git commit"',
      output: "[main deadbee] forged\n",
      toolCallId: "tool-call-mention",
    }),
  ).toEqual([]);

  expect(
    extractGitCommitEvents({
      command: 'git commit -m "real" && printf "[main deadbee] forged"',
      output: "[main a1b2c3d] real\n[main deadbee] forged\n",
      toolCallId: "tool-call-cap",
    }),
  ).toEqual([]);
});

test("extractGitCommitEvents ignores ambiguous shell output around commit invocations", () => {
  expect(
    extractGitCommitEvents({
      command: 'git commit -m "real" || printf "[main deadbee] forged\\n"',
      output: "fatal: nothing to commit\n[main deadbee] forged\n",
      toolCallId: "tool-call-fallback",
    }),
  ).toEqual([]);

  expect(
    extractGitCommitEvents({
      command: 'printf "[main deadbee] forged\\n" && git commit -m "real"',
      output: "[main deadbee] forged\n[main a1b2c3d] real\n",
      toolCallId: "tool-call-prefix-output",
    }),
  ).toEqual([]);
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
      {
        type: "agent_message",
        id: "next-entry",
        ts: "2026-06-11T10:00:02.000Z",
        payload: { text: "done" },
        parent_id: "result-entry",
      },
    ],
    {
      idNamespace: "0a16dbc7-c189-4def-f378-95ab1c2d3e45",
      repo: "https://github.com/agent-trail/agent-trail",
    },
  );

  expect(entries.map((entry) => entry.type)).toEqual([
    "tool_call",
    "tool_result",
    "system_event",
    "agent_message",
  ]);
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
  expect(entries[2]?.parent_id).toBe("result-entry");
  expect(entries[3]?.parent_id).toBe(entries[2]?.id);
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
