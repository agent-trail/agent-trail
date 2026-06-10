import type { ViewerEvent } from "../gist-viewer.ts";
import { cn, FOCUS_RING } from "./ui.tsx";
import {
  DISCLOSURE_MARKER_CLASS,
  EventHeaderContent,
  SECTION_SUMMARY_CLASS,
} from "./viewer-shared.tsx";
import {
  itemDomId,
  itemKey,
  type ToolTranscriptItem,
  type TranscriptItem,
  toolGroupTimestamp,
  toolRuleLabel,
} from "./viewer-transcript-model.ts";

export function ToolCard({
  index,
  item,
}: {
  index: number;
  item: Extract<TranscriptItem, { kind: "tool" }>;
}) {
  const primary = item.call ?? item.result ?? item.abort;
  if (primary === undefined) return null;

  return (
    <article className="min-w-0 scroll-mt-8" id={itemDomId(item)}>
      <details className="viewer-tool-event-details group/tool-event min-w-0">
        <summary className={cn("viewer-tool-event-summary", SECTION_SUMMARY_CLASS, FOCUS_RING)}>
          <EventHeaderContent index={index} label={toolRuleLabel(primary)} timestamp={primary.ts} />
          <span className={DISCLOSURE_MARKER_CLASS}>
            <span className="group-open/tool-event:hidden">[+]</span>
            <span className="hidden group-open/tool-event:inline">[-]</span>
          </span>
        </summary>
        <ToolEventBody className="mt-3 border-t-main pt-3" item={item} />
      </details>
    </article>
  );
}

export function ToolGroupCard({
  index,
  item,
}: {
  index: number;
  item: Extract<TranscriptItem, { kind: "tool_group" }>;
}) {
  return (
    <article className="min-w-0 scroll-mt-8" id={itemDomId(item)}>
      <details className="viewer-tool-group-details group/tool-group min-w-0">
        <summary
          className={cn("viewer-tool-group-summary border-none", SECTION_SUMMARY_CLASS, FOCUS_RING)}
        >
          <EventHeaderContent
            index={index}
            label={`Tool_group: ${item.items.length} Events`}
            timestamp={toolGroupTimestamp(item)}
          />
          <span className={DISCLOSURE_MARKER_CLASS}>
            <span className="group-open/tool-group:hidden">[+]</span>
            <span className="hidden group-open/tool-group:inline">[-]</span>
          </span>
        </summary>
        <div className="viewer-tool-group-stack mt-3 grid">
          {item.items.map((toolItem, toolIndex) => (
            <ToolDetails compact item={toolItem} key={itemKey(toolItem, toolIndex)} />
          ))}
        </div>
      </details>
    </article>
  );
}

function ToolDetails({
  className,
  compact = false,
  item,
}: {
  className?: string;
  compact?: boolean;
  item: ToolTranscriptItem;
}) {
  return (
    <details
      className={cn(
        "viewer-tool-details group/tool bg-bg",
        compact ? "viewer-tool-details-compact" : "border-main",
        className,
      )}
    >
      <summary
        className={cn(
          "viewer-tool-summary viewer-pressable flex min-h-7 cursor-pointer list-none items-center justify-between gap-4 px-3 py-1.5 text-[10px] font-bold tracking-[0.08em] uppercase tabular-nums [&::-webkit-details-marker]:hidden",
          compact ? "bg-bg" : "bg-accent",
          FOCUS_RING,
        )}
      >
        <span>{item.call?.title ?? item.result?.title ?? item.abort?.title ?? "Tool event"}</span>
        <span className="text-[10px] font-normal text-muted">
          <span className="group-open/tool:hidden">[+]</span>
          <span className="hidden group-open/tool:inline">[-]</span>
        </span>
      </summary>
      <ToolEventBody className="border-t-main px-3 py-3" item={item} />
    </details>
  );
}

function ToolEventBody({ className, item }: { className?: string; item: ToolTranscriptItem }) {
  const resultLabel = item.result?.title ?? "Tool result";
  const abortLabel = item.abort?.title ?? "Tool aborted";
  return (
    <div className={cn("grid gap-3", className)}>
      {item.call !== undefined ? <ToolCallBody event={item.call} /> : null}
      {item.abort !== undefined ? <ToolAbortPanel event={item.abort} label={abortLabel} /> : null}
      {item.result !== undefined ? (
        <ToolResultPanel
          event={item.result}
          label={resultLabel}
          terminal={isShellCommandTool(item.call)}
        />
      ) : null}
    </div>
  );
}

function ToolCallBody({ event }: { event: ViewerEvent }) {
  return (
    <section className="grid min-w-0 gap-2">
      {event.meta.length > 0 ? (
        <ToolMeta event={event} terminalCommand={isShellCommandTool(event)} />
      ) : null}
    </section>
  );
}

function ToolResultPanel({
  event,
  label,
  terminal,
}: {
  event: ViewerEvent;
  label: string;
  terminal: boolean;
}) {
  const parsedBody = terminal
    ? parseToolResultBody(event.body)
    : { meta: [], output: event.body ?? "" };
  const meta = [...resultMeta(event), ...parsedBody.meta];
  return (
    <details className="viewer-result-details group/result min-w-0 border-main bg-bg">
      <summary
        className={cn(
          "viewer-result-summary viewer-pressable flex min-h-7 cursor-pointer list-none items-center justify-between gap-4 bg-accent px-3 py-1.5 text-[10px] font-bold tracking-[0.12em] uppercase tabular-nums [&::-webkit-details-marker]:hidden",
          FOCUS_RING,
        )}
      >
        <span>{label}</span>
        <span className="text-[10px] font-normal text-muted">
          <span className="group-open/result:hidden">[+]</span>
          <span className="hidden group-open/result:inline">[-]</span>
        </span>
      </summary>
      <div className="grid max-h-80 gap-2 overflow-auto border-t-main p-3">
        {meta.length > 0 ? <ToolMetaItems items={meta} /> : null}
        {parsedBody.output.length > 0 ? (
          <ToolOutputBody output={parsedBody.output} terminal={terminal} />
        ) : (
          <p className="m-0 text-xs text-muted uppercase">No display text</p>
        )}
      </div>
    </details>
  );
}

function ToolAbortPanel({ event, label }: { event: ViewerEvent; label: string }) {
  const meta = resultMeta(event);
  return (
    <section className="viewer-result-details min-w-0 border-main bg-bg">
      <div className="viewer-result-summary flex min-h-7 items-center justify-between gap-4 bg-accent px-3 py-1.5 text-[10px] font-bold tracking-[0.12em] uppercase tabular-nums">
        <span>{label}</span>
      </div>
      <div className="grid gap-2 border-t-main p-3">
        {meta.length > 0 ? <ToolMetaItems items={meta} /> : null}
        {event.body !== null && event.body.length > 0 ? (
          <pre className="m-0 min-w-0 whitespace-pre-wrap break-words text-xs leading-5">
            <code>{event.body}</code>
          </pre>
        ) : null}
      </div>
    </section>
  );
}

function ToolOutputBody({ output, terminal }: { output: string; terminal: boolean }) {
  if (terminal) {
    return <TerminalBlock value={output} />;
  }

  return (
    <pre className="m-0 min-w-0 whitespace-pre-wrap break-words text-xs leading-5">
      <code>{output}</code>
    </pre>
  );
}

function isShellCommandTool(event: ViewerEvent | undefined): boolean {
  if (event === undefined) return false;
  const toolName = event.title.replace(/^Tool call:\s*/i, "").toLowerCase();
  return (
    toolName === "shell_command" ||
    toolName === "shell" ||
    toolName === "bash" ||
    event.meta.some((item) => item.label.toLowerCase() === "command")
  );
}

function ToolMeta({
  event,
  excludedLabels = [],
  terminalCommand = false,
}: {
  event: ViewerEvent;
  excludedLabels?: string[];
  terminalCommand?: boolean;
}) {
  const meta = event.meta.filter((item) => !excludedLabels.includes(item.label));
  return <ToolMetaItems items={meta} terminalCommand={terminalCommand} />;
}

function ToolMetaItems({
  items,
  terminalCommand = false,
}: {
  items: ViewerEvent["meta"];
  terminalCommand?: boolean;
}) {
  const commandCwd = terminalCommand
    ? items.find((item) => item.label.toLowerCase() === "cwd")?.value
    : undefined;
  const hasCommand = items.some((item) => item.label.toLowerCase() === "command");
  const visibleItems =
    terminalCommand && hasCommand
      ? items.filter((item) => item.label.toLowerCase() !== "cwd")
      : items;

  return (
    <dl className="m-0 grid gap-1 text-[11px] leading-5 text-muted">
      {visibleItems.map((item) => {
        const isTerminalCommand = terminalCommand && item.label.toLowerCase() === "command";
        return (
          <div
            className={cn(
              "grid min-w-0 gap-2",
              isTerminalCommand ? "" : "grid-cols-[5rem_minmax(0,1fr)]",
            )}
            key={item.label}
          >
            <dt className={isTerminalCommand ? "sr-only" : "font-bold uppercase"}>{item.label}:</dt>
            <ToolMetaValue commandCwd={commandCwd} item={item} terminalCommand={terminalCommand} />
          </div>
        );
      })}
    </dl>
  );
}

function ToolMetaValue({
  commandCwd,
  item,
  terminalCommand = false,
}: {
  commandCwd?: string;
  item: ViewerEvent["meta"][number];
  terminalCommand?: boolean;
}) {
  if (terminalCommand && item.label.toLowerCase() === "command") {
    return (
      <dd className="m-0 min-w-0">
        <TerminalBlock cwd={commandCwd} prompt value={item.value} />
      </dd>
    );
  }

  if (isDiffMetaItem(item)) {
    return (
      <dd className="m-0 min-w-0">
        {isUnifiedDiff(item.value) ? (
          <UnifiedDiffBlock value={item.value} />
        ) : (
          <pre className="viewer-code-block m-0 max-h-80 min-w-0 overflow-auto border-main bg-bg p-2 text-[11px] leading-5 text-fg">
            <code>{normalizeCodeBlockText(item.value)}</code>
          </pre>
        )}
      </dd>
    );
  }

  return <dd className="m-0 break-words">{item.value}</dd>;
}

function TerminalBlock({
  cwd,
  prompt = false,
  value,
}: {
  cwd?: string;
  prompt?: boolean;
  value: string;
}) {
  return (
    <div className="viewer-terminal-block min-w-0 border-main bg-fg text-bg">
      <div className="viewer-terminal-header flex min-w-0 items-center justify-between gap-3 border-b border-bg/30 px-3 py-1.5 text-[9px] font-bold tracking-[0.18em] uppercase">
        <span>terminal</span>
        {cwd !== undefined ? (
          <span className="min-w-0 truncate font-normal tracking-normal text-bg/70 normal-case">
            {cwd}
          </span>
        ) : null}
      </div>
      <pre className="m-0 min-w-0 overflow-auto px-3 py-2 whitespace-pre-wrap break-words text-[11px] leading-5">
        <code>
          {prompt ? <span className="select-none text-bg/60">$ </span> : null}
          {value}
        </code>
      </pre>
    </div>
  );
}

function UnifiedDiffBlock({ value }: { value: string }) {
  const rows = diffRows(normalizeCodeBlockText(value));
  return (
    <pre className="viewer-diff-block m-0 max-h-72 min-w-0 overflow-auto border-main bg-bg text-[11px] leading-5 text-fg">
      <code className="block min-w-max py-1 pr-4">
        {rows.map((row) => (
          <span className={cn("block px-2", diffLineClass(row.line))} key={row.key}>
            {row.line.length > 0 ? row.line : " "}
          </span>
        ))}
      </code>
    </pre>
  );
}

function isDiffMetaItem(item: ViewerEvent["meta"][number]): boolean {
  return item.label.toLowerCase() === "diff";
}

function isUnifiedDiff(value: string): boolean {
  const lines = normalizeCodeBlockText(value).split("\n");
  return (
    lines.some((line) => line.startsWith("--- ")) &&
    lines.some((line) => line.startsWith("+++ ")) &&
    lines.some((line) => line.startsWith("@@"))
  );
}

function diffLineClass(line: string): string {
  if (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  ) {
    return "viewer-diff-line-file";
  }
  if (line.startsWith("@@")) return "viewer-diff-line-hunk";
  if (line.startsWith("+")) return "viewer-diff-line-add";
  if (line.startsWith("-")) return "viewer-diff-line-remove";
  return "viewer-diff-line-context";
}

function diffRows(value: string): { key: string; line: string }[] {
  const countsByLine = new Map<string, number>();
  return value.split("\n").map((line) => {
    const count = (countsByLine.get(line) ?? 0) + 1;
    countsByLine.set(line, count);
    return { key: `${line}:${count}`, line };
  });
}

function normalizeCodeBlockText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
}

function resultMeta(event: ViewerEvent): ViewerEvent["meta"] {
  return event.meta.filter((item) => item.label !== "for");
}

function parseToolResultBody(body: string | null): {
  meta: ViewerEvent["meta"];
  output: string;
} {
  if (body === null || body.length === 0) return { meta: [], output: "" };
  const lines = body.split("\n");
  const meta: ViewerEvent["meta"] = [];
  const outputLines: string[] = [];
  let inOutput = false;

  for (const line of lines) {
    if (!inOutput) {
      const processExitMatch = /^Process exited with code (-?\d+)$/.exec(line);
      if (processExitMatch?.[1] !== undefined) {
        meta.push({ label: "exit code", value: processExitMatch[1] });
        continue;
      }
      const item = parseToolMetaLine(line);
      if (item !== null) {
        if (item.label === "output") {
          inOutput = true;
          if (item.value.length > 0) outputLines.push(item.value);
          continue;
        }
        meta.push(item);
        continue;
      }
    }
    outputLines.push(line);
  }

  const promotedOutput = promoteOutputPreambleMeta(outputLines);
  return { meta: [...meta, ...promotedOutput.meta], output: promotedOutput.output };
}

function promoteOutputPreambleMeta(lines: string[]): {
  meta: ViewerEvent["meta"];
  output: string;
} {
  const meta: ViewerEvent["meta"] = [];
  let index = 0;

  while (index < lines.length) {
    const item = parseToolMetaLine(lines[index] ?? "");
    if (item === null || item.label === "output") break;
    meta.push(item);
    index += 1;
  }

  if (meta.length === 0 || lines[index] !== "") {
    return { meta: [], output: lines.join("\n").trimStart() };
  }

  while (lines[index] === "") index += 1;
  return { meta, output: lines.slice(index).join("\n").trimStart() };
}

function parseToolMetaLine(line: string): ViewerEvent["meta"][number] | null {
  const match = /^([A-Za-z][A-Za-z0-9 _-]{0,32}):\s*(.*)$/.exec(line);
  if (match?.[1] === undefined) return null;
  return {
    label: match[1].trim().toLowerCase().replace(/\s+/g, " "),
    value: match[2] ?? "",
  };
}
