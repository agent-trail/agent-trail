import { useEffect, useMemo, useRef, useState } from "react";

import type { GistViewerModel } from "../gist-viewer.ts";
import type { ViewerShellModel } from "../site.ts";
import { cn, FixedPageScroll, FOCUS_RING } from "./ui.tsx";
import {
  type SidebarCenterRequest,
  useViewerScrollSync,
  type ViewerSidebarLinkElement,
} from "./viewer-scroll-sync.ts";
import { TranscriptPane } from "./viewer-transcript.tsx";
import {
  type ActiveFilters,
  buildTranscriptItemsForViewer,
  DEFAULT_FILTERS,
  type EventFilter,
  FILTERS,
  itemDomId,
  itemKey,
  itemLabel,
  itemPreview,
  type TranscriptItem,
} from "./viewer-transcript-model.ts";

export {
  isScrollInterruptionKey,
  resolveProgrammaticSettledItem,
  setHashForSidebarTarget,
  shouldCenterSidebar,
  shouldCommitSidebarActiveState,
} from "./viewer-scroll-sync.ts";
export { buildTranscriptItemsForViewer } from "./viewer-transcript-model.ts";

type ViewerModel = GistViewerModel | ViewerShellModel;

export function ViewerShell({ model }: { model: ViewerModel }) {
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(DEFAULT_FILTERS);
  const items = useMemo(
    () =>
      model.status === "loaded" ? buildTranscriptItemsForViewer(model.events, activeFilters) : [],
    [activeFilters, model],
  );
  const { activeItemId, onTranscriptScrollRoot, scrollToItem, sidebarCenterRequest } =
    useViewerScrollSync(items);
  const toggleFilter = (filter: EventFilter) => {
    setActiveFilters((current) => ({ ...current, [filter]: !current[filter] }));
  };

  return (
    <FixedPageScroll>
      <section
        aria-labelledby="viewer-title"
        className="grid h-full min-h-0 w-full max-w-full overflow-hidden bg-bg text-fg lg:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)]"
      >
        <ViewerAside
          activeFilters={activeFilters}
          activeItemId={activeItemId}
          items={items}
          model={model}
          onToggleFilter={toggleFilter}
          sidebarCenterRequest={sidebarCenterRequest}
          scrollToItem={scrollToItem}
        />
        <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] lg:block lg:h-full">
          {model.status === "loaded" ? (
            <MobileFilterBar
              activeFilters={activeFilters}
              itemCount={items.length}
              onToggleFilter={toggleFilter}
            />
          ) : null}
          <TranscriptPane items={items} model={model} onScrollRoot={onTranscriptScrollRoot} />
        </div>
      </section>
    </FixedPageScroll>
  );
}

function ViewerAside({
  activeFilters,
  activeItemId,
  items,
  model,
  onToggleFilter,
  sidebarCenterRequest,
  scrollToItem,
}: {
  activeFilters: ActiveFilters;
  activeItemId: string;
  items: TranscriptItem[];
  model: ViewerModel;
  onToggleFilter: (filter: EventFilter) => void;
  sidebarCenterRequest: SidebarCenterRequest | null;
  scrollToItem: (itemId: string) => void;
}) {
  const linkRefs = useRef(new Map<string, ViewerSidebarLinkElement>());

  useEffect(() => {
    if (sidebarCenterRequest === null) return;
    linkRefs.current
      .get(sidebarCenterRequest.itemId)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [sidebarCenterRequest]);

  return (
    <aside
      className="hidden min-h-0 min-w-0 flex-col border-b-main bg-bg lg:flex lg:border-b-0"
      aria-label="Events"
    >
      <div className="flex min-h-13 shrink-0 items-center justify-between border-r-main border-b-main bg-accent px-3">
        <div>
          <h2 className="m-0 text-[10px] font-bold tracking-[0.22em] uppercase">Events</h2>
          <p className="mt-1 mb-0 text-[9px] tracking-[0.12em] text-muted uppercase">
            {model.status === "loaded" ? items.length : 0} total
          </p>
        </div>
        <FilterControls activeFilters={activeFilters} onToggleFilter={onToggleFilter} />
      </div>
      {model.status === "loaded" ? (
        <nav
          aria-label="Event timeline"
          className="min-h-0 flex-1 scroll-smooth overflow-y-auto border-r-main px-4 py-4"
        >
          {items.length === 0 ? (
            <p className="m-0 text-[11px] leading-5 text-muted">No matching events</p>
          ) : (
            <ol className="m-0 grid list-none gap-2 p-0">
              {items.map((item, index) => {
                const itemId = itemDomId(item);
                const isActive = activeItemId === itemId;
                return (
                  <li key={itemKey(item, index)}>
                    <a
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "grid grid-cols-[3rem_minmax(0,1fr)] gap-3 text-[11px] leading-5 no-underline hover:bg-accent",
                        isActive ? "bg-fg text-bg hover:bg-fg" : "",
                        FOCUS_RING,
                      )}
                      href={`#${itemId}`}
                      onClick={(event) => {
                        event.preventDefault();
                        scrollToItem(itemId);
                      }}
                      ref={(node) => {
                        if (node === null) {
                          linkRefs.current.delete(itemId);
                        } else {
                          linkRefs.current.set(itemId, node as ViewerSidebarLinkElement);
                        }
                      }}
                    >
                      <span className="font-bold tracking-[0.08em] uppercase">
                        {itemLabel(item)}
                      </span>
                      <span className={cn("truncate", isActive ? "text-bg" : "text-muted")}>
                        {itemPreview(item)}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
          )}
        </nav>
      ) : (
        <div className="border-r-main p-4 text-xs text-muted">{statusLabel(model)}</div>
      )}
    </aside>
  );
}

function MobileFilterBar({
  activeFilters,
  itemCount,
  onToggleFilter,
}: {
  activeFilters: ActiveFilters;
  itemCount: number;
  onToggleFilter: (filter: EventFilter) => void;
}) {
  return (
    <div className="viewer-mobile-filter-bar flex min-h-12 shrink-0 items-center justify-between border-b-main bg-accent px-3 lg:hidden">
      <div>
        <p className="m-0 text-[10px] font-bold tracking-[0.22em] uppercase">Events</p>
        <p className="mt-1 mb-0 text-[9px] tracking-[0.12em] text-muted uppercase">
          {itemCount} total
        </p>
      </div>
      <FilterControls activeFilters={activeFilters} onToggleFilter={onToggleFilter} />
    </div>
  );
}

function FilterControls({
  activeFilters,
  onToggleFilter,
}: {
  activeFilters: ActiveFilters;
  onToggleFilter: (filter: EventFilter) => void;
}) {
  return (
    <fieldset className="m-0 flex gap-1 border-0 p-0">
      <legend className="sr-only">Event filters</legend>
      {FILTERS.map((filter) => (
        <button
          aria-label={filter.label}
          aria-pressed={activeFilters[filter.filter]}
          className={cn(
            "viewer-pressable grid h-5 min-w-5 place-items-center border-main bg-bg px-1 text-[9px] font-bold",
            activeFilters[filter.filter] ? "text-fg" : "text-muted opacity-45",
            FOCUS_RING,
          )}
          key={filter.filter}
          onClick={() => onToggleFilter(filter.filter)}
          title={filter.label}
          type="button"
        >
          {filter.shortLabel}
        </button>
      ))}
    </fieldset>
  );
}

function statusLabel(model: ViewerModel): string {
  if (model.status === "loaded") return "Loaded";
  if (model.status === "error") return "Error";
  return model.status;
}
