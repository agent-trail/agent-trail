import { useCallback, useEffect, useRef } from "react";

import type { GistViewerModel } from "../gist-viewer.ts";
import type { ViewerShellModel } from "../site.ts";
import { cn, FOCUS_RING } from "./ui.tsx";
import { bindDeadMarkdownLinkGuard, renderViewerMarkdown } from "./viewer-markdown.ts";
import {
  DISCLOSURE_MARKER_CLASS,
  EventHeaderContent,
  EventMeta,
  SECTION_SUMMARY_CLASS,
} from "./viewer-shared.tsx";
import { ToolCard, ToolGroupCard } from "./viewer-tool.tsx";
import {
  agentRuleLabel,
  isThinkingEvent,
  itemDomId,
  itemKey,
  type TranscriptItem,
} from "./viewer-transcript-model.ts";

type ViewerModel = GistViewerModel | ViewerShellModel;

export function TranscriptPane({
  items,
  model,
  onScrollRoot,
}: {
  items: TranscriptItem[];
  model: ViewerModel;
  onScrollRoot: (node: HTMLElement | null) => void;
}) {
  const deadLinkGuardCleanupRef = useRef<(() => void) | null>(null);
  const handleScrollRoot = useCallback(
    (node: HTMLElement | null) => {
      deadLinkGuardCleanupRef.current?.();
      deadLinkGuardCleanupRef.current = node === null ? null : bindDeadMarkdownLinkGuard(node);
      onScrollRoot(node);
    },
    [onScrollRoot],
  );

  useEffect(() => {
    return () => {
      deadLinkGuardCleanupRef.current?.();
      deadLinkGuardCleanupRef.current = null;
    };
  }, []);

  if (model.status !== "loaded") {
    return (
      <main
        className="h-full min-h-0 min-w-0 scroll-smooth overflow-y-auto bg-bg px-4 py-8 md:px-6 md:py-10"
        aria-labelledby="viewer-title"
      >
        <div className="mx-auto max-w-4xl">
          <p className="m-0 text-[10px] font-bold tracking-[0.34em] text-muted uppercase">
            Trail transcript
          </p>
          <h1 id="viewer-title" className="mt-3 mb-0 text-3xl leading-tight font-bold">
            {model.title}
          </h1>
          <p className="mt-4 mb-0 max-w-[72ch] text-sm leading-6 text-muted">{bodyText(model)}</p>
          {"diagnostics" in model && model.diagnostics.length > 0 ? (
            <DiagnosticsList diagnostics={model.diagnostics} />
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main
      className="h-full min-h-0 min-w-0 scroll-smooth overflow-y-auto bg-bg px-4 py-6 md:px-6 md:py-8"
      aria-labelledby="viewer-title"
      ref={handleScrollRoot}
    >
      <div className="mx-auto grid max-w-[52rem] gap-8 pb-40 md:gap-10">
        <h1 id="viewer-title" className="sr-only">
          Trail transcript
        </h1>
        {model.diagnostics.length > 0 ? <DiagnosticsList diagnostics={model.diagnostics} /> : null}
        <EventTranscript items={items} />
      </div>
    </main>
  );
}

function EventTranscript({ items }: { items: TranscriptItem[] }) {
  if (items.length === 0) {
    return (
      <section aria-label="Trail transcript events" className="grid min-w-0 gap-8 md:gap-10">
        <div className="viewer-empty-state border-main bg-accent px-3 py-2 text-xs leading-5 text-muted">
          No events match selected filters.
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Trail transcript events" className="grid min-w-0 gap-8 md:gap-10">
      {items.map((item, index) => (
        <TranscriptCard index={index} item={item} key={itemKey(item, index)} />
      ))}
    </section>
  );
}

function TranscriptCard({ index, item }: { index: number; item: TranscriptItem }) {
  if (item.kind === "user") {
    const renderedMarkdownProps = {
      dangerouslySetInnerHTML: { __html: renderViewerMarkdown(item.event.body ?? "") },
    };
    return (
      <article className="min-w-0 scroll-mt-8" id={itemDomId(item)}>
        <details className="viewer-user-details group/user min-w-0" open>
          <summary className={cn("viewer-user-summary", SECTION_SUMMARY_CLASS, FOCUS_RING)}>
            <EventHeaderContent index={index} label="User_input" timestamp={item.event.ts} />
            <span className={DISCLOSURE_MARKER_CLASS}>
              <span className="group-open/user:hidden">[+]</span>
              <span className="hidden group-open/user:inline">[-]</span>
            </span>
          </summary>
          <div className="viewer-user-message mt-4 flex max-w-[48rem] gap-2 border-main bg-accent px-3 py-2 text-sm leading-7 font-normal">
            <span className="select-none text-muted">$</span>
            <div className="viewer-message-markdown min-w-0" {...renderedMarkdownProps} />
          </div>
        </details>
      </article>
    );
  }

  if (item.kind === "agent" && isThinkingEvent(item.event)) {
    const renderedMarkdownProps = {
      dangerouslySetInnerHTML: { __html: renderViewerMarkdown(item.event.body ?? "") },
    };
    return (
      <details
        className="viewer-thinking-details group/thinking min-w-0 scroll-mt-8"
        id={itemDomId(item)}
        open
      >
        <summary className={cn("viewer-thinking-summary", SECTION_SUMMARY_CLASS, FOCUS_RING)}>
          <EventHeaderContent index={index} label="Thought" timestamp={item.event.ts} />
          <span className={DISCLOSURE_MARKER_CLASS}>
            <span className="group-open/thinking:hidden">[+]</span>
            <span className="hidden group-open/thinking:inline">[-]</span>
          </span>
        </summary>
        <div className="ml-4 border-l-main p-3">
          <div
            className="viewer-message-markdown text-[11px] leading-relaxed text-muted"
            {...renderedMarkdownProps}
          />
          {item.event.meta.length > 0 ? <EventMeta event={item.event} /> : null}
        </div>
      </details>
    );
  }

  if (item.kind === "agent") {
    const renderedMarkdownProps = {
      dangerouslySetInnerHTML: { __html: renderViewerMarkdown(item.event.body ?? "") },
    };
    return (
      <article className="min-w-0 scroll-mt-8" id={itemDomId(item)}>
        <details className="viewer-agent-details group/agent min-w-0" open>
          <summary className={cn("viewer-agent-summary", SECTION_SUMMARY_CLASS, FOCUS_RING)}>
            <EventHeaderContent
              index={index}
              label={agentRuleLabel(item.event)}
              timestamp={item.event.ts}
            />
            <span className={DISCLOSURE_MARKER_CLASS}>
              <span className="group-open/agent:hidden">[+]</span>
              <span className="hidden group-open/agent:inline">[-]</span>
            </span>
          </summary>
          <div className="viewer-agent-message mt-4 border-l-2 border-fg pl-3 text-sm leading-relaxed font-normal">
            <div className="viewer-message-markdown text-sm leading-7" {...renderedMarkdownProps} />
            {item.event.meta.length > 0 ? <EventMeta event={item.event} /> : null}
          </div>
        </details>
      </article>
    );
  }

  if (item.kind === "tool_group") {
    return <ToolGroupCard index={index} item={item} />;
  }

  return <ToolCard index={index} item={item} />;
}

function DiagnosticsList({
  diagnostics,
}: {
  diagnostics: Extract<GistViewerModel, { status: "loaded" }>["diagnostics"];
}) {
  return (
    <section aria-labelledby="viewer-diagnostics" className="grid gap-3">
      <h2 id="viewer-diagnostics" className="text-xs font-bold tracking-[0.22em] uppercase">
        Diagnostics
      </h2>
      <ul className="m-0 grid gap-2 p-0">
        {diagnostics.map((diagnostic) => (
          <li
            className="list-none border-main bg-accent px-4 py-3 text-sm"
            key={`${diagnostic.line}:${diagnostic.path}:${diagnostic.code}:${diagnostic.message}`}
          >
            <span className="font-bold">{diagnostic.code}</span>: {diagnostic.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function bodyText(model: ViewerModel): string {
  if (model.status === "loaded") {
    return "Shared trail loaded, decoded, and checked with reader-tolerant validation.";
  }
  if (model.status === "error") return model.message;
  return model.body;
}
