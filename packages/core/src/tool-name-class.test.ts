import { expect, test } from "bun:test";
import { classifyToolName, type ToolNameClass } from "./index.ts";

function expectToolNameClasses(cases: Array<[string, ToolNameClass]>): void {
  expect(Object.fromEntries(cases.map(([name]) => [name, classifyToolName(name)]))).toEqual(
    Object.fromEntries(cases),
  );
}

test("classifies representative tool names through the public core export", () => {
  expect(classifyToolName("Read")).toBe("read");
  expect(classifyToolName("apply_patch")).toBe("edit");
  expect(classifyToolName("bash")).toBe("bash");
  expect(classifyToolName("find")).toBe("read");
  expect(classifyToolName("unknown_tool")).toBe("other");
});

test("treats object prototype names as unknown tool names", () => {
  expect(classifyToolName("toString")).toBe("other");
  expect(classifyToolName("constructor")).toBe("other");
  expect(classifyToolName("hasOwnProperty")).toBe("other");
  expect(classifyToolName("__proto__")).toBe("other");
});

test("classifies live adapter tool vocabularies", () => {
  expectToolNameClasses([
    ["Read", "read"],
    ["Edit", "edit"],
    ["Write", "write"],
    ["MultiEdit", "edit"],
    ["NotebookEdit", "write"],
    ["Bash", "bash"],
    ["Grep", "grep"],
    ["Glob", "glob"],
    ["Task", "task"],
    ["Agent", "task"],
    ["Skill", "tool"],
    ["WebFetch", "tool"],
    ["WebSearch", "tool"],
    ["ToolSearch", "tool"],
    ["TodoWrite", "tool"],
    ["AskUserQuestion", "tool"],
    ["shell_command", "bash"],
    ["exec_command", "bash"],
    ["write_stdin", "bash"],
    ["shell", "bash"],
    ["apply_patch", "edit"],
    ["spawn_agent", "task"],
    ["read", "read"],
    ["write", "write"],
    ["edit", "edit"],
    ["bash", "bash"],
    ["grep", "grep"],
    ["find", "read"],
    ["ls", "read"],
    ["str_replace", "edit"],
  ]);
});

test("classifies queued SQLite and hybrid adapter candidates", () => {
  expectToolNameClasses([
    ["Shell", "bash"],
    ["StrReplace", "edit"],
    ["LS", "read"],
    ["view", "read"],
    ["report_intent", "tool"],
    ["read", "read"],
    ["edit", "edit"],
    ["write", "write"],
    ["bash", "bash"],
    ["grep", "grep"],
    ["glob", "glob"],
    ["task", "task"],
  ]);
});

test("classifies the remaining initial cross-agent corpus", () => {
  expectToolNameClasses([
    ["read_file", "read"],
    ["list_directory", "read"],
    ["write_file", "write"],
    ["edit_file", "edit"],
    ["replace", "edit"],
    ["run_command", "bash"],
    ["execute_command", "bash"],
    ["run_shell_command", "bash"],
    ["search_files", "grep"],
    ["grep_search", "grep"],
    ["view_file", "read"],
    ["read_url_content", "read"],
    ["replace_file_content", "edit"],
    ["multi_replace_file_content", "edit"],
    ["write_to_file", "write"],
    ["define_subagent", "task"],
    ["invoke_subagent", "task"],
    ["manage_subagents", "task"],
    ["send_message", "task"],
    ["manage_task", "task"],
    ["ask_permission", "tool"],
    ["ask_question", "tool"],
    ["schedule", "tool"],
    ["search_web", "tool"],
    ["generate_image", "tool"],
    ["create_file", "write"],
    ["look_at", "read"],
    ["undo_edit", "edit"],
    ["finder", "grep"],
    ["read_web_page", "read"],
    ["skill", "tool"],
    ["exec", "bash"],
    ["process", "bash"],
    ["browser", "tool"],
    ["web_search", "tool"],
    ["web_fetch", "tool"],
    ["image", "tool"],
    ["canvas", "tool"],
    ["tts", "tool"],
    ["message", "tool"],
    ["nodes", "tool"],
    ["sessions_list", "task"],
    ["sessions_history", "task"],
    ["sessions_send", "task"],
    ["sessions_spawn", "task"],
    ["subagents", "task"],
    ["agents_list", "task"],
    ["session_status", "task"],
    ["fs_search", "grep"],
    ["patch", "edit"],
    ["multi_patch", "edit"],
    ["undo", "edit"],
    ["remove", "edit"],
    ["fetch", "read"],
    ["todo_write", "tool"],
    ["todo_read", "tool"],
    ["parallel", "task"],
    ["terminal", "bash"],
    ["browser_navigate", "tool"],
    ["browser_snapshot", "tool"],
    ["browser_click", "tool"],
    ["browser_type", "tool"],
    ["browser_scroll", "tool"],
    ["browser_press", "tool"],
    ["browser_back", "tool"],
    ["browser_close", "tool"],
    ["browser_vision", "tool"],
    ["browser_console", "tool"],
    ["browser_get_images", "tool"],
    ["vision_analyze", "read"],
    ["delegate_task", "task"],
    ["execute_code", "bash"],
    ["todo", "tool"],
    ["memory", "tool"],
    ["session_search", "tool"],
    ["skill_view", "tool"],
    ["skills_list", "tool"],
    ["skill_manage", "tool"],
    ["clarify", "tool"],
    ["text_to_speech", "tool"],
    ["cronjob", "tool"],
    ["ReadFile", "read"],
    ["WriteFile", "write"],
    ["EditFile", "edit"],
    ["RunTerminalCommand", "bash"],
    ["LaunchSubagent", "task"],
    ["ProposePlanToUser", "tool"],
    ["subagent__ZencoderSubagent", "task"],
    ["zencoder-rag-mcp__web_search", "read"],
    ["code_interpreter", "bash"],
    ["read_files", "read"],
    ["apply_file_diff", "edit"],
    ["search_codebase", "grep"],
    ["call_mcp_tool", "tool"],
    ["read_mcp_resource", "tool"],
    ["suggest_plan", "tool"],
    ["suggest_create_plan", "tool"],
    ["write_to_long_running_shell_command", "bash"],
    ["read_shell_command_output", "read"],
    ["use_computer", "tool"],
    ["my_subagent_tool", "task"],
    ["totally_unknown", "other"],
  ]);
});

test("accepts agent context without changing current classifications", () => {
  expect(classifyToolName("edit_file", "cursor")).toBe("edit");
  expect(classifyToolName("edit_file", "copilot-chat")).toBe("edit");
  expect(classifyToolName("edit_file", "x-com-example-agent")).toBe("edit");
});
