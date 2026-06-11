import { useOverflowScrollPosition } from "@n8tb1t/use-scroll-position";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpecPageModel, SpecSampleBlock, SpecSection } from "../site.ts";
import { JsonlCode } from "./jsonl-code.tsx";
import { cn, FOCUS_RING } from "./ui.tsx";

const LEFT_STORAGE_KEY = "agent-trail-spec-left-collapsed";
const RIGHT_STORAGE_KEY = "agent-trail-spec-right-collapsed";

type BrowserRuntime = typeof globalThis & {
  addEventListener?: (type: "hashchange", listener: () => void) => void;
  location?: { hash: string };
  localStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
  matchMedia?: (query: string) => { matches: boolean };
  removeEventListener?: (type: "hashchange", listener: () => void) => void;
};

export function SpecPage({ model }: { model: SpecPageModel }) {
  return (
    <main className="fixed-page-scroll overflow-hidden bg-bg text-fg" id="page-content">
      <SpecReaderLayout model={model} />
    </main>
  );
}

function SpecReaderLayout({ model }: { model: SpecPageModel }) {
  const [articleElement, setArticleElement] = useState<SpecScrollElement | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useStoredCollapsedState(LEFT_STORAGE_KEY);
  const [rightCollapsed, setRightCollapsed] = useStoredCollapsedState(RIGHT_STORAGE_KEY);
  const { activeSectionId, progress, scrollToSection, setScrollRootRef } = useActiveSpecSection(
    articleElement,
    model.sections,
  );
  const activeSample = useActiveSample(activeSectionId, model.sections, model.sampleBlocks);
  const handleArticleRef = useCallback(
    (node: unknown) => {
      const article = node as HTMLElement | null;
      setArticleElement(article as SpecScrollElement | null);
      setScrollRootRef(article);
    },
    [setScrollRootRef],
  );
  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-cols-1",
        rightCollapsed
          ? "xl:grid-cols-[auto_minmax(0,1fr)_auto]"
          : "xl:grid-cols-[auto_minmax(0,3fr)_minmax(0,2fr)]",
      )}
    >
      <SpecSidebar
        activeSectionId={activeSectionId}
        collapsed={leftCollapsed}
        onToggle={() => setLeftCollapsed((collapsed) => !collapsed)}
        progress={progress}
        scrollToSection={scrollToSection}
        sections={model.sections}
      />
      <SpecArticle model={model} onArticleRef={handleArticleRef} />
      <SpecSampleRail
        activeSectionId={activeSectionId}
        activeSample={activeSample}
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed((collapsed) => !collapsed)}
      />
    </div>
  );
}

function SpecSidebar({
  activeSectionId,
  collapsed,
  onToggle,
  progress,
  scrollToSection,
  sections,
}: {
  activeSectionId: string;
  collapsed: boolean;
  onToggle: () => void;
  progress: number;
  scrollToSection: (sectionId: string) => void;
  sections: SpecSection[];
}) {
  const activeRef = useRef<SpecSidebarLinkElement>(null);
  const groups = useMemo(() => groupSpecSections(sections), [sections]);
  const sectionLabels = useMemo(() => sectionLabelsById(sections), [sections]);

  useEffect(() => {
    if (collapsed || activeSectionId === "") return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeSectionId, collapsed]);

  if (collapsed) {
    return (
      <CollapsedSidebarRail
        label="navigation map"
        onToggle={onToggle}
        side="left"
        title="Navigation_map"
      />
    );
  }

  return (
    <aside
      className="relative hidden min-h-0 w-72 border-r-main bg-accent xl:flex"
      aria-label="Specification navigation map"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-12 shrink-0 items-center justify-between border-b-main p-4">
          <h2 className="m-0 text-[10px] font-bold tracking-[0.28em] text-muted uppercase">
            Navigation_map
          </h2>
          <SidebarToggle
            collapsed={collapsed}
            label="navigation map"
            onToggle={onToggle}
            side="left"
          />
        </div>
        <nav
          className="min-h-0 flex-1 scroll-smooth overflow-y-auto px-4 py-5"
          aria-label="Specification sections"
        >
          <div className="grid gap-7">
            {groups.map((group) => (
              <section key={group.label}>
                <h3 className="m-0 mb-3 text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
                  {group.label}
                </h3>
                <ol className="grid list-none gap-1 p-0">
                  {group.sections.map((section) => (
                    <li key={section.id}>
                      <a
                        aria-current={activeSectionId === section.id ? "true" : undefined}
                        className={cn(
                          "block py-1 text-xs leading-5 no-underline",
                          section.level > 2 ? "pl-3 text-[11px]" : "font-bold",
                          section.level > 3 ? "pl-6 text-[10px]" : "",
                          activeSectionId === section.id
                            ? "bg-fg px-2 text-bg"
                            : "px-2 text-fg/80 hover:bg-bg hover:text-fg",
                          FOCUS_RING,
                        )}
                        href={`#${section.id}`}
                        onClick={(event) => {
                          event.preventDefault();
                          scrollToSection(section.id);
                        }}
                        ref={
                          activeSectionId === section.id
                            ? (node) => {
                                activeRef.current = node as SpecSidebarLinkElement | null;
                              }
                            : undefined
                        }
                      >
                        <span
                          className={cn(
                            "mr-2 text-[9px] tabular-nums",
                            activeSectionId === section.id ? "text-bg" : "text-muted",
                          )}
                        >
                          {sectionLabels.get(section.id) ?? formatSectionIndex(section)}
                        </span>
                        {cleanSectionTitle(section.title)}
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </nav>
        <div className="flex shrink-0 justify-between border-t-main bg-accent p-4 text-[10px] font-bold tracking-[0.22em] text-muted uppercase">
          <span>Progress</span>
          <span className="tabular-nums">{String(progress).padStart(3, "0")}%</span>
        </div>
      </div>
    </aside>
  );
}

function SpecArticle({
  model,
  onArticleRef,
}: {
  model: SpecPageModel;
  onArticleRef: (node: unknown) => void;
}) {
  const renderedMarkdownProps = {
    dangerouslySetInnerHTML: { __html: model.html },
  };
  const rootSectionId = model.sections[0]?.id;

  return (
    <article
      className="min-h-full min-w-0 scroll-smooth overflow-y-auto bg-bg px-5 py-8 md:px-10 lg:px-16"
      ref={onArticleRef}
    >
      <header className="mx-auto grid w-full max-w-3xl gap-4 border-b-main pb-10">
        <p className="m-0 text-[10px] tracking-[0.3em] text-muted uppercase">Specification</p>
        <h1
          className="text-balance text-4xl leading-tight font-bold tracking-[0.015em] sm:text-5xl"
          id={rootSectionId}
        >
          Agent Trail Specification
        </h1>
        <p className="m-0 max-w-[72ch] text-pretty text-sm leading-7">
          Route: <code>/spec/{model.routeVersion}</code>. Version {model.version}, {model.status},{" "}
          {model.license}.
        </p>
      </header>
      <div className="markdown-body mx-auto w-full max-w-3xl" {...renderedMarkdownProps} />
      <footer className="mx-auto mt-16 w-full max-w-3xl border-t-main pt-5 text-sm text-muted">
        Agent Trail v{model.version} · {model.status} · {model.license}
      </footer>
    </article>
  );
}

function SpecSampleRail({
  activeSample,
  activeSectionId,
  collapsed,
  onToggle,
}: {
  activeSample: SpecSampleBlock | undefined;
  activeSectionId: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { previousSample, visibleSample } = useAnimatedSample(activeSample);
  const highlightedLines = useMemo(
    () => new Set(visibleSample?.highlightLinesBySectionId?.[activeSectionId] ?? []),
    [activeSectionId, visibleSample],
  );

  if (collapsed) {
    return (
      <CollapsedSidebarRail
        label="trail samples"
        onToggle={onToggle}
        side="right"
        title="Sample trail JSONL"
      />
    );
  }

  return (
    <aside
      className="relative hidden min-h-0 min-w-0 border-l-main bg-bg xl:flex"
      aria-label="Contextual trail JSONL samples"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-4 border-b-main p-4">
          <SidebarToggle
            collapsed={collapsed}
            label="trail samples"
            onToggle={onToggle}
            side="right"
          />
          <h2 className="m-0 text-[10px] font-bold tracking-[0.28em] text-muted uppercase">
            Sample trail JSONL
          </h2>
          <span className="ml-auto text-[9px] text-muted uppercase">
            application/vnd.trail+jsonl
          </span>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-4">
          <div className="relative h-full min-h-0">
            {previousSample === undefined ? null : (
              <SpecSamplePanel
                className="spec-sample-panel-exit absolute inset-x-0 top-0 pointer-events-none"
                highlightedLines={new Set()}
                sample={previousSample}
              />
            )}
            {visibleSample === undefined ? (
              <div className="border-main bg-accent p-5 text-xs text-muted">
                No contextual trail sample for this section.
              </div>
            ) : (
              <SpecSamplePanel
                className="spec-sample-panel-enter"
                highlightedLines={highlightedLines}
                key={visibleSample.id}
                sample={visibleSample}
              />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function SpecSamplePanel({
  className,
  highlightedLines,
  sample,
}: {
  className?: string;
  highlightedLines: Set<number>;
  sample: SpecSampleBlock;
}) {
  return (
    <section
      className={cn("border-main flex max-h-full min-h-0 flex-col bg-accent p-5", className)}
      aria-live="polite"
    >
      <div className="mb-5 flex shrink-0 items-center justify-between gap-4 border-b-main pb-3">
        <h3 className="m-0 text-[10px] font-bold tracking-widest uppercase">
          {"// "}
          {sample.title}
        </h3>
      </div>
      <pre className="m-0 min-h-0 max-w-full flex-1 overflow-auto text-[11px] leading-6 whitespace-pre-wrap break-words">
        <JsonlCode
          className="grid gap-1 break-words"
          lineClassName={(index) =>
            cn(
              "block break-words px-2 py-1 whitespace-pre-wrap",
              highlightedLines.has(index) && "sample-line-highlight",
            )
          }
          lines={sample.lines}
        />
      </pre>
    </section>
  );
}

function useAnimatedSample(activeSample: SpecSampleBlock | undefined) {
  const [visibleSample, setVisibleSample] = useState(activeSample);
  const [previousSample, setPreviousSample] = useState<SpecSampleBlock | undefined>();

  useEffect(() => {
    if (activeSample?.id === visibleSample?.id) return;
    setPreviousSample(visibleSample);
    setVisibleSample(activeSample);
    const timeout = setTimeout(() => setPreviousSample(undefined), 180);
    return () => clearTimeout(timeout);
  }, [activeSample, visibleSample]);

  return { previousSample, visibleSample };
}

function CollapsedSidebarRail({
  label,
  onToggle,
  side,
  title,
}: {
  label: string;
  onToggle: () => void;
  side: "left" | "right";
  title: string;
}) {
  return (
    <aside
      aria-label={title}
      className={cn(
        "relative hidden min-h-0 w-px shrink-0 overflow-visible bg-bg xl:block",
        side === "left" ? "border-r-main" : "border-l-main",
      )}
    >
      <div className={cn("absolute top-2 z-10", side === "left" ? "left-2" : "right-2")}>
        <SidebarToggle collapsed={true} label={label} onToggle={onToggle} side={side} />
      </div>
    </aside>
  );
}

function SidebarToggle({
  collapsed,
  label,
  onToggle,
  side,
}: {
  collapsed: boolean;
  label: string;
  onToggle: () => void;
  side: "left" | "right";
}) {
  return (
    <button
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
      aria-pressed={collapsed}
      className={cn(
        "btn-hover hit-area-40 border-main group relative flex size-6 shrink-0 items-center justify-center bg-bg text-[10px] font-bold",
        side === "left" ? "order-last" : "order-first",
        FOCUS_RING,
      )}
      onClick={onToggle}
      title="Toggle sidebar"
      type="button"
    >
      {collapsed ? "+" : "-"}
      <span
        className={cn(
          "sidebar-toggle-tooltip pointer-events-none absolute top-1/2 z-20 border-main bg-bg px-2 py-1 text-[10px] font-bold whitespace-nowrap text-fg uppercase opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          side === "left" ? "left-full ml-2" : "right-full mr-2",
        )}
      >
        Toggle sidebar
      </span>
    </button>
  );
}

function useStoredCollapsedState(key: string) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const runtime = globalThis as BrowserRuntime;
    const stored = runtime.localStorage?.getItem(key);
    if (stored === "true" || stored === "false") {
      setCollapsed(stored === "true");
      return;
    }

    setCollapsed(runtime.matchMedia?.("(max-width: 1279px)")?.matches ?? false);
  }, [key]);

  useEffect(() => {
    const runtime = globalThis as BrowserRuntime;
    runtime.localStorage?.setItem(key, String(collapsed));
  }, [collapsed, key]);

  return [collapsed, setCollapsed] as const;
}

type SpecScrollElement = {
  clientHeight: number;
  querySelector: (selector: string) => SpecHeadingElement | null;
  scrollHeight: number;
  scrollTop: number;
};

type SpecHeadingElement = {
  id: string;
  offsetTop: number;
  scrollIntoView: (options: { block: "start"; behavior: "smooth" }) => void;
};

type SpecSidebarLinkElement = {
  scrollIntoView: (options: { block: "center"; behavior: "smooth" }) => void;
};

type SpecNavGroup = {
  label: string;
  sections: SpecSection[];
};

function groupSpecSections(sections: SpecSection[]): SpecNavGroup[] {
  const groups = new Map<string, SpecSection[]>();
  let currentSectionNumber: number | undefined;

  for (const section of sections) {
    const sectionNumber = sectionNumberOf(section.title);
    if (sectionNumber !== undefined) currentSectionNumber = sectionNumber;
    const label = navGroupLabel(section, sectionNumber ?? currentSectionNumber);
    const group = groups.get(label) ?? [];
    group.push(section);
    groups.set(label, group);
  }
  return Array.from(groups, ([label, groupedSections]) => ({ label, sections: groupedSections }));
}

function navGroupLabel(section: SpecSection, sectionNumber: number | undefined): string {
  if (isReferenceSection(section.title)) return "REFERENCE";
  if (section.index === 0 || sectionNumber === undefined || sectionNumber <= 4) return "CORE";
  if (sectionNumber <= 9) return "STRUCTURE";
  if (sectionNumber <= 11) return "EVENTS";
  if (sectionNumber <= 14) return "EXTENSIONS";
  if (sectionNumber <= 18) return "VALIDATION";
  return "REFERENCE";
}

function isReferenceSection(title: string): boolean {
  const normalized = title.toLowerCase();
  return (
    normalized === "changelog" ||
    normalized.startsWith("appendix ") ||
    normalized.startsWith("license") ||
    normalized.startsWith("v0.")
  );
}

function sectionNumberOf(title: string): number | undefined {
  const match = /^(\d+)/.exec(title);
  if (match?.[1] === undefined) return undefined;
  return Number.parseInt(match[1], 10);
}

function formatSectionIndex(section: SpecSection): string {
  const numberMatch = /^(\d+(?:\.\d+)*)/.exec(section.title);
  if (numberMatch?.[1] !== undefined) return numberMatch[1];
  return String(section.index).padStart(2, "0");
}

function sectionLabelsById(sections: SpecSection[]): Map<string, string> {
  const labels = new Map<string, string>();
  let counters: number[] = [];

  for (const section of sections) {
    const explicitNumber = /^(\d+(?:\.\d+)*)/.exec(section.title)?.[1];
    if (explicitNumber !== undefined) {
      const explicitCounters = explicitNumber.split(".").map((part) => Number.parseInt(part, 10));
      if (shouldUseGeneratedLabelForExplicitCounter(counters, explicitCounters)) {
        counters = nextCountersAtDepth(counters, explicitCounters.length);
      } else {
        counters = explicitCounters;
      }
      labels.set(section.id, counters.join("."));
      continue;
    }

    if (section.index === 0 || section.level <= 1) {
      labels.set(section.id, String(section.index).padStart(2, "0"));
      continue;
    }

    const depth = section.level - 1;
    counters = nextCountersAtDepth(counters, depth);
    labels.set(section.id, counters.join("."));
  }

  return labels;
}

function shouldUseGeneratedLabelForExplicitCounter(
  currentCounters: number[],
  explicitCounters: number[],
): boolean {
  const depth = explicitCounters.length;
  if (depth === 0 || currentCounters.length < depth) return false;
  const parentMatches = explicitCounters
    .slice(0, -1)
    .every((part, index) => currentCounters[index] === part);
  return parentMatches && (explicitCounters.at(-1) ?? 0) <= (currentCounters[depth - 1] ?? 0);
}

function nextCountersAtDepth(counters: number[], depth: number): number[] {
  const next = counters.slice(0, depth);
  while (next.length < depth) next.push(0);
  next[depth - 1] = (next[depth - 1] ?? 0) + 1;
  return next;
}

function cleanSectionTitle(title: string): string {
  return title.replace(/^\d+(?:\.\d+)*\.?\s+/, "");
}

function useActiveSpecSection(article: SpecScrollElement | null, sections: SpecSection[]) {
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id ?? "");
  const [progress, setProgress] = useState(0);
  const programmaticScrollRef = useRef<{
    targetId: string;
    settleTimeout: ReturnType<typeof setTimeout> | undefined;
  } | null>(null);

  const updateProgress = useCallback(
    (scrollTop: number) => {
      if (article === null) return;
      const scrollableHeight = article.scrollHeight - article.clientHeight;
      setProgress(
        scrollableHeight <= 0 ? 0 : Math.min(100, Math.round((scrollTop / scrollableHeight) * 100)),
      );
    },
    [article],
  );

  const updateActiveSection = useCallback(
    (scrollTop: number) => {
      if (article === null) return;
      const headings = collectSectionHeadings(article, sections);
      if (headings.length === 0) return;

      let activeId = headings[0]?.id ?? "";

      for (const heading of headings) {
        if (heading.offsetTop <= scrollTop + 112) {
          activeId = heading.id;
        } else {
          break;
        }
      }

      setActiveSectionId(activeId);
      updateProgress(scrollTop);
    },
    [article, sections, updateProgress],
  );

  const finishProgrammaticScroll = useCallback(
    (targetId: string, scrollTop: number) => {
      const current = programmaticScrollRef.current;
      if (current?.settleTimeout !== undefined) clearTimeout(current.settleTimeout);
      programmaticScrollRef.current = null;
      setActiveSectionId(targetId);
      updateProgress(scrollTop);
    },
    [updateProgress],
  );

  const beginProgrammaticScroll = useCallback(
    (sectionId: string, shouldScroll: boolean) => {
      if (article === null) return;

      const heading = article.querySelector(`[id="${escapeSelectorAttribute(sectionId)}"]`);
      if (heading === null) return;

      const current = programmaticScrollRef.current;
      if (current?.settleTimeout !== undefined) clearTimeout(current.settleTimeout);
      programmaticScrollRef.current = {
        targetId: sectionId,
        settleTimeout: setTimeout(() => {
          finishProgrammaticScroll(sectionId, article.scrollTop);
        }, 1200),
      };

      if (shouldScroll) heading.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    [article, finishProgrammaticScroll],
  );

  const [setScrollRootRef] = useOverflowScrollPosition(({ currPos }) => {
    const programmaticScroll = programmaticScrollRef.current;
    if (programmaticScroll !== null) {
      updateProgress(currPos.y);
      if (programmaticScroll.settleTimeout !== undefined) {
        clearTimeout(programmaticScroll.settleTimeout);
      }
      programmaticScroll.settleTimeout = setTimeout(() => {
        finishProgrammaticScroll(programmaticScroll.targetId, currPos.y);
      }, 180);
      return;
    }

    updateActiveSection(currPos.y);
  });

  const scrollToSection = useCallback(
    (sectionId: string) => {
      beginProgrammaticScroll(sectionId, true);
      const runtime = globalThis as BrowserRuntime;
      if (runtime.location !== undefined) runtime.location.hash = sectionId;
    },
    [beginProgrammaticScroll],
  );

  useEffect(() => {
    if (article === null) return;
    const runtime = globalThis as BrowserRuntime;

    const initialHash = runtime.location?.hash?.replace(/^#/, "");
    if (initialHash !== undefined && initialHash !== "") {
      article
        .querySelector(`[id="${escapeSelectorAttribute(initialHash)}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    updateActiveSection(article.scrollTop);
  }, [article, updateActiveSection]);

  useEffect(() => {
    if (article === null) return;
    const runtime = globalThis as BrowserRuntime;
    const handleHashChange = () => {
      const sectionId = runtime.location?.hash?.replace(/^#/, "");
      if (sectionId === undefined || sectionId === "") return;
      beginProgrammaticScroll(sectionId, false);
    };

    runtime.addEventListener?.("hashchange", handleHashChange);
    return () => runtime.removeEventListener?.("hashchange", handleHashChange);
  }, [article, beginProgrammaticScroll]);

  return { activeSectionId, progress, scrollToSection, setScrollRootRef };
}

function escapeSelectorAttribute(value: string): string {
  const runtime = globalThis as typeof globalThis & {
    CSS?: { escape?: (value: string) => string };
  };
  return runtime.CSS?.escape?.(value) ?? cssEscape(value);
}

function cssEscape(value: string): string {
  let escaped = "";

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const char = value.charAt(index);

    if (codeUnit === 0x0000) {
      escaped += "\uFFFD";
      continue;
    }

    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && value.charCodeAt(0) === 0x002d)
    ) {
      escaped += `\\${codeUnit.toString(16)} `;
      continue;
    }

    if (index === 0 && codeUnit === 0x002d && value.length === 1) {
      escaped += "\\-";
      continue;
    }

    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      escaped += char;
      continue;
    }

    escaped += `\\${char}`;
  }

  return escaped;
}

function collectSectionHeadings(
  article: SpecScrollElement,
  sections: SpecSection[],
): SpecHeadingElement[] {
  return sections
    .map((section) => article.querySelector(`[id="${escapeSelectorAttribute(section.id)}"]`))
    .filter((heading): heading is SpecHeadingElement => heading !== null)
    .sort((a, b) => a.offsetTop - b.offsetTop);
}

function useActiveSample(
  activeSectionId: string,
  _sections: SpecSection[],
  samples: SpecSampleBlock[],
) {
  return useMemo(() => {
    return samples.find((sample) => sample.sectionIds.includes(activeSectionId));
  }, [activeSectionId, samples]);
}
