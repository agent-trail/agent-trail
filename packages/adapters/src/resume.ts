import type { ResumeCommand, ResumeSessionResult, SessionRef } from "./index.ts";

export function resumeCommand(ref: SessionRef, label: string, argv: string[]): ResumeSessionResult {
  if (ref.id.trim().length === 0) {
    return { supported: false, reason: "Resume requires a session id" };
  }
  const command: ResumeCommand = { label, argv };
  if (ref.cwd !== undefined) command.cwd = ref.cwd;
  return { supported: true, command };
}
