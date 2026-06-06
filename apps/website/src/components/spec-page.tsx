import { useOverflowScrollPosition } from "@n8tb1t/use-scroll-position";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpecPageModel, SpecSampleBlock, SpecSection } from "../site.ts";
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
        activeSampleId={activeSample?.id}
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed((collapsed) => !collapsed)}
        samples={model.sampleBlocks}
        scrollToSection={scrollToSection}
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

  useEffect(() => {
    if (collapsed || activeSectionId === "") return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeSectionId, collapsed]);

  return (
    <aside
      className={cn(
        "relative hidden min-h-0 border-r-main bg-bg xl:flex",
        collapsed ? "w-8" : "w-72",
      )}
      aria-label="Specification navigation map"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-12 shrink-0 items-center justify-between border-b-main p-4">
          <h2 className="m-0 text-[10px] font-bold tracking-[0.28em] text-muted uppercase">
            {collapsed ? "" : "Navigation_map"}
          </h2>
          <SidebarToggle
            collapsed={collapsed}
            label="navigation map"
            onToggle={onToggle}
            side="left"
          />
        </div>
        <nav
          className={cn(
            "min-h-0 flex-1 scroll-smooth overflow-y-auto p-4",
            collapsed ? "hidden" : "block",
          )}
          aria-label="Specification sections"
        >
          <ol className="mt-4 grid list-none gap-1 p-0">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  aria-current={activeSectionId === section.id ? "true" : undefined}
                  className={cn(
                    "block px-2 py-1 text-[11px] no-underline",
                    section.level > 2 ? "pl-5 text-[10px]" : "font-bold",
                    activeSectionId === section.id
                      ? "bg-fg text-bg"
                      : "text-muted hover:bg-accent hover:text-fg",
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
                  <span className="mr-2 text-[9px] opacity-70">
                    {String(section.index + 1).padStart(2, "0")}
                  </span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div
          className={cn(
            "shrink-0 justify-between border-t-main bg-bg p-4 text-[10px] font-bold tracking-[0.22em] text-muted uppercase",
            collapsed ? "hidden" : "flex",
          )}
        >
          <span>Progress</span>
          <span>{String(progress).padStart(3, "0")}%</span>
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

  return (
    <article
      className="min-h-full min-w-0 scroll-smooth overflow-y-auto px-5 py-8 md:px-10 lg:px-16"
      ref={onArticleRef}
    >
      <header className="mx-auto grid w-full max-w-4xl gap-4 border-b-main pb-10">
        <p className="m-0 text-[10px] tracking-[0.3em] text-muted uppercase">Specification</p>
        <h1 className="text-balance text-4xl leading-tight font-bold sm:text-5xl">
          Agent Trail Specification
        </h1>
        <p className="m-0 max-w-[72ch] text-pretty text-sm leading-7">
          Route: <code>/spec/{model.routeVersion}</code>. Version {model.version}, {model.status},{" "}
          {model.license}.
        </p>
      </header>
      <div className="markdown-body mx-auto w-full max-w-4xl" {...renderedMarkdownProps} />
      <footer className="mx-auto mt-16 w-full max-w-4xl border-t-main pt-5 text-sm text-muted">
        Agent Trail v{model.version} · {model.status} · {model.license}
      </footer>
    </article>
  );
}

function SpecSampleRail({
  activeSampleId,
  collapsed,
  onToggle,
  samples,
  scrollToSection,
}: {
  activeSampleId: string | undefined;
  collapsed: boolean;
  onToggle: () => void;
  samples: SpecSampleBlock[];
  scrollToSection: (sectionId: string) => void;
}) {
  const activeRef = useRef<SpecSampleElement>(null);

  useEffect(() => {
    if (collapsed || activeSampleId === undefined) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeSampleId, collapsed]);

  return (
    <aside
      className={cn(
        "relative hidden min-h-0 min-w-0 border-l-main bg-bg xl:flex",
        collapsed ? "w-8" : "w-full",
      )}
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
            {collapsed ? "" : "Sample trail JSONL"}
          </h2>
          <span
            className={cn("ml-auto text-[9px] text-muted uppercase", collapsed ? "hidden" : "")}
          >
            application/vnd.trail+jsonl
          </span>
        </div>
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4",
            "scroll-smooth",
            collapsed ? "hidden" : "block",
          )}
        >
          <div className="grid gap-3">
            {samples.map((sample) => {
              const isActive = activeSampleId === sample.id;
              const targetSectionId = sample.sectionIds[0];
              return (
                <button
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "w-full border-main bg-bg p-4 text-left transition-opacity",
                    targetSectionId === undefined ? "cursor-default" : "btn-hover",
                    isActive ? "bg-accent opacity-100" : "opacity-45",
                    FOCUS_RING,
                  )}
                  disabled={targetSectionId === undefined}
                  key={sample.id}
                  onClick={() => {
                    if (targetSectionId !== undefined) scrollToSection(targetSectionId);
                  }}
                  ref={
                    isActive
                      ? (node) => {
                          activeRef.current = node as SpecSampleElement | null;
                        }
                      : undefined
                  }
                  type="button"
                >
                  <h3 className="m-0 mb-3 text-[10px] font-bold tracking-widest uppercase">
                    {"// "}
                    {sample.title}
                  </h3>
                  <pre className="m-0 max-w-full overflow-hidden text-[10px] leading-5 whitespace-pre-wrap break-words">
                    <code className="break-words">{sample.lines.join("\n")}</code>
                  </pre>
                </button>
              );
            })}
          </div>
        </div>
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
        "btn-hover border-main flex size-6 shrink-0 items-center justify-center bg-bg text-[10px] font-bold",
        side === "left" ? "order-last" : "order-first",
        FOCUS_RING,
      )}
      onClick={onToggle}
      type="button"
    >
      {collapsed ? "+" : "-"}
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

    setCollapsed(runtime.matchMedia?.("(max-width: 1279px)").matches ?? false);
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

type SpecSampleElement = {
  scrollIntoView: (options: { block: "center"; behavior: "smooth" }) => void;
};

type SpecSidebarLinkElement = {
  scrollIntoView: (options: { block: "center"; behavior: "smooth" }) => void;
};

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
      if (heading === undefined || heading === null) return;

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

    const initialHash = runtime.location?.hash.replace(/^#/, "");
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
      const sectionId = runtime.location?.hash.replace(/^#/, "");
      if (sectionId === undefined || sectionId === "") return;
      beginProgrammaticScroll(sectionId, false);
    };

    runtime.addEventListener?.("hashchange", handleHashChange);
    return () => runtime.removeEventListener?.("hashchange", handleHashChange);
  }, [article, beginProgrammaticScroll]);

  return { activeSectionId, progress, scrollToSection, setScrollRootRef };
}

function escapeSelectorAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
