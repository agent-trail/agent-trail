import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { itemDomId, type TranscriptItem } from "./viewer-transcript-model.ts";

type ViewerRect = { top: number };
type ViewerScrollElement = {
  getBoundingClientRect: () => ViewerRect;
};
type ViewerScrollRootEventMap = {
  pointerdown: PointerEvent;
  scroll: Event;
  touchstart: TouchEvent;
  wheel: WheelEvent;
};
type ViewerScrollRoot = ViewerScrollElement & {
  addEventListener: <K extends keyof ViewerScrollRootEventMap>(
    type: K,
    listener: (event: ViewerScrollRootEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) => void;
  querySelector: (selector: string) => ViewerScrollElement | null;
  removeEventListener: <K extends keyof ViewerScrollRootEventMap>(
    type: K,
    listener: (event: ViewerScrollRootEventMap[K]) => void,
  ) => void;
  scrollTo: (options: { behavior: "smooth"; top: number }) => void;
  scrollTop: number;
};

type ViewerHashRuntime = {
  history?: { pushState: (data: unknown, unused: string, url?: string | URL | null) => void };
  location?: { hash: string };
};

type BrowserRuntime = typeof globalThis &
  ViewerHashRuntime & {
    addEventListener?: (
      type: "hashchange" | "keydown" | "popstate",
      listener: (event: Event) => void,
      options?: AddEventListenerOptions,
    ) => void;
    removeEventListener?: (
      type: "hashchange" | "keydown" | "popstate",
      listener: (event: Event) => void,
    ) => void;
  };

export type ViewerSidebarLinkElement = {
  scrollIntoView: (options: { block: "center"; behavior: "auto" | "smooth" }) => void;
};

type ViewerScrollSource = "hash" | "manual" | "sidebar-click";

export type SidebarCenterRequest = {
  itemId: string;
  token: number;
};

export function useViewerScrollSync(items: TranscriptItem[]): {
  activeItemId: string;
  onTranscriptScrollRoot: (node: HTMLElement | null) => void;
  sidebarCenterRequest: SidebarCenterRequest | null;
  scrollToItem: (itemId: string) => void;
} {
  const itemIds = useMemo(() => items.map(itemDomId), [items]);
  const [scrollRoot, setScrollRoot] = useState<ViewerScrollRoot | null>(null);
  const [activeItemId, setActiveItemId] = useState(() => itemIds[0] ?? "");
  const [sidebarCenterRequest, setSidebarCenterRequest] = useState<SidebarCenterRequest | null>(
    null,
  );
  const manualScrollIdleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const programmaticScrollRef = useRef<{
    source: Exclude<ViewerScrollSource, "manual">;
    settleTimeout: ReturnType<typeof setTimeout> | undefined;
    targetItemId: string;
  } | null>(null);
  const sidebarCenterTokenRef = useRef(0);
  const onTranscriptScrollRoot = useCallback((node: HTMLElement | null) => {
    setScrollRoot(node as unknown as ViewerScrollRoot | null);
  }, []);

  const setActiveItem = useCallback((itemId: string) => {
    setActiveItemId((current) => (current === itemId ? current : itemId));
  }, []);

  const requestSidebarCenter = useCallback((itemId: string) => {
    sidebarCenterTokenRef.current += 1;
    setSidebarCenterRequest({ itemId, token: sidebarCenterTokenRef.current });
  }, []);

  const measureActiveItemFromScroll = useCallback((): string | null => {
    if (scrollRoot === null || itemIds.length === 0) return null;

    const activationTop = scrollRoot.scrollTop + 96;
    let nextActiveItemId = itemIds[0] ?? "";

    for (const itemId of itemIds) {
      const itemElement = scrollRoot.querySelector(`#${itemId}`);
      if (itemElement === null) continue;
      if (elementTopWithinScrollRoot(scrollRoot, itemElement) > activationTop) break;
      nextActiveItemId = itemId;
    }

    return nextActiveItemId;
  }, [itemIds, scrollRoot]);

  const clearProgrammaticScroll = useCallback(() => {
    const programmaticScroll = programmaticScrollRef.current;
    if (programmaticScroll?.settleTimeout !== undefined) {
      clearTimeout(programmaticScroll.settleTimeout);
    }
    programmaticScrollRef.current = null;
  }, []);

  const clearManualScrollIdle = useCallback(() => {
    if (manualScrollIdleRef.current !== undefined) {
      clearTimeout(manualScrollIdleRef.current);
    }
    manualScrollIdleRef.current = undefined;
  }, []);

  const commitActiveItemAfterIdle = useCallback(() => {
    const measuredItemId = measureActiveItemFromScroll();
    manualScrollIdleRef.current = undefined;
    if (measuredItemId === null) return;
    if (shouldCommitSidebarActiveState("manual-scroll-idle")) {
      setActiveItem(measuredItemId);
    }
    if (shouldCenterSidebar("manual-scroll-idle")) {
      requestSidebarCenter(measuredItemId);
    }
  }, [measureActiveItemFromScroll, requestSidebarCenter, setActiveItem]);

  const finishProgrammaticScroll = useCallback(
    (targetItemId: string) => {
      const programmaticScroll = programmaticScrollRef.current;
      if (programmaticScroll?.settleTimeout !== undefined) {
        clearTimeout(programmaticScroll.settleTimeout);
      }
      programmaticScrollRef.current = null;
      const settledItemId = resolveProgrammaticSettledItem(
        measureActiveItemFromScroll(),
        targetItemId,
        itemIds,
      );
      if (settledItemId !== null) {
        setActiveItem(settledItemId);
        if (shouldCenterSidebar("programmatic-settle")) requestSidebarCenter(settledItemId);
      }
    },
    [itemIds, measureActiveItemFromScroll, requestSidebarCenter, setActiveItem],
  );

  const beginProgrammaticScroll = useCallback(
    (itemId: string, shouldScroll: boolean, source: Exclude<ViewerScrollSource, "manual">) => {
      if (scrollRoot === null) return;
      const itemElement = scrollRoot.querySelector(`#${itemId}`);
      if (itemElement === null) return;
      clearProgrammaticScroll();
      clearManualScrollIdle();

      programmaticScrollRef.current = {
        source,
        targetItemId: itemId,
        settleTimeout: setTimeout(() => {
          finishProgrammaticScroll(itemId);
        }, 1200),
      };

      if (shouldScroll) {
        scrollRoot.scrollTo({
          behavior: "smooth",
          top: elementTopWithinScrollRoot(scrollRoot, itemElement),
        });
      }
    },
    [clearManualScrollIdle, clearProgrammaticScroll, finishProgrammaticScroll, scrollRoot],
  );

  const scrollToItem = useCallback(
    (itemId: string) => {
      beginProgrammaticScroll(itemId, true, "sidebar-click");
      setHashForSidebarTarget(itemId);
    },
    [beginProgrammaticScroll],
  );

  useEffect(() => {
    setActiveItemId((current) => {
      if (itemIds.length === 0) return "";
      return current !== "" && itemIds.includes(current) ? current : (itemIds[0] ?? "");
    });
  }, [itemIds]);

  useEffect(() => {
    if (scrollRoot === null) return;

    const handleScroll = () => {
      const programmaticScroll = programmaticScrollRef.current;
      if (programmaticScroll !== null) {
        if (programmaticScroll.settleTimeout !== undefined) {
          clearTimeout(programmaticScroll.settleTimeout);
        }
        programmaticScroll.settleTimeout = setTimeout(() => {
          finishProgrammaticScroll(programmaticScroll.targetItemId);
        }, 180);
        return;
      }

      clearManualScrollIdle();
      manualScrollIdleRef.current = setTimeout(commitActiveItemAfterIdle, 180);
    };

    const cancelProgrammaticScroll = () => {
      clearProgrammaticScroll();
    };

    scrollRoot.addEventListener("scroll", handleScroll, { passive: true });
    scrollRoot.addEventListener("wheel", cancelProgrammaticScroll, { passive: true });
    scrollRoot.addEventListener("touchstart", cancelProgrammaticScroll, { passive: true });
    scrollRoot.addEventListener("pointerdown", cancelProgrammaticScroll, { passive: true });
    const initialActiveItemId = measureActiveItemFromScroll();
    if (initialActiveItemId !== null) setActiveItem(initialActiveItemId);

    return () => {
      scrollRoot.removeEventListener("scroll", handleScroll);
      scrollRoot.removeEventListener("wheel", cancelProgrammaticScroll);
      scrollRoot.removeEventListener("touchstart", cancelProgrammaticScroll);
      scrollRoot.removeEventListener("pointerdown", cancelProgrammaticScroll);
      clearManualScrollIdle();
    };
  }, [
    clearManualScrollIdle,
    clearProgrammaticScroll,
    commitActiveItemAfterIdle,
    finishProgrammaticScroll,
    measureActiveItemFromScroll,
    scrollRoot,
    setActiveItem,
  ]);

  useEffect(() => {
    const runtime = globalThis as BrowserRuntime;
    if (scrollRoot === null || runtime.location === undefined) return;

    const scrollToHash = () => {
      const targetItemId = runtime.location?.hash.slice(1) ?? "";
      if (targetItemId.length > 0 && itemIds.includes(targetItemId)) {
        beginProgrammaticScroll(targetItemId, true, "hash");
      }
    };

    scrollToHash();
    runtime.addEventListener?.("hashchange", scrollToHash);
    runtime.addEventListener?.("popstate", scrollToHash);
    return () => {
      runtime.removeEventListener?.("hashchange", scrollToHash);
      runtime.removeEventListener?.("popstate", scrollToHash);
    };
  }, [beginProgrammaticScroll, itemIds, scrollRoot]);

  useEffect(() => {
    const runtime = globalThis as BrowserRuntime;
    const handleKeyDown = (event: Event) => {
      const key = eventKey(event);
      if (key !== null && isScrollInterruptionKey(key)) clearProgrammaticScroll();
    };

    runtime.addEventListener?.("keydown", handleKeyDown);
    return () => {
      runtime.removeEventListener?.("keydown", handleKeyDown);
    };
  }, [clearProgrammaticScroll]);

  useEffect(() => {
    return () => {
      clearProgrammaticScroll();
      clearManualScrollIdle();
    };
  }, [clearManualScrollIdle, clearProgrammaticScroll]);

  return {
    activeItemId,
    onTranscriptScrollRoot,
    sidebarCenterRequest,
    scrollToItem,
  };
}

export function shouldCenterSidebar(
  phase: "manual-active-change" | "manual-scroll-idle" | "programmatic-settle",
): boolean {
  return phase !== "manual-active-change";
}

export function shouldCommitSidebarActiveState(
  phase: "manual-active-change" | "manual-scroll-idle" | "programmatic-settle",
): boolean {
  return phase !== "manual-active-change";
}

export function resolveProgrammaticSettledItem(
  measuredItemId: string | null,
  targetItemId: string,
  itemIds: readonly string[],
): string | null {
  if (measuredItemId !== null && itemIds.includes(measuredItemId)) return measuredItemId;
  return itemIds.includes(targetItemId) ? targetItemId : null;
}

export function isScrollInterruptionKey(key: string): boolean {
  return (
    key === "ArrowDown" ||
    key === "ArrowUp" ||
    key === "End" ||
    key === "Home" ||
    key === "PageDown" ||
    key === "PageUp" ||
    key === " " ||
    key === "Spacebar"
  );
}

function eventKey(event: Event): string | null {
  if (!("key" in event)) return null;
  const key = event.key;
  return typeof key === "string" ? key : null;
}

export function setHashForSidebarTarget(
  itemId: string,
  runtime: ViewerHashRuntime = globalThis as ViewerHashRuntime,
): "hash" | "none" | "pushState" {
  const hash = `#${itemId}`;
  if (runtime.location === undefined) return "none";
  if (runtime.location.hash === hash) return "none";
  if (runtime.history !== undefined) {
    runtime.history.pushState(null, "", hash);
    return "pushState";
  }
  runtime.location.hash = hash;
  return "hash";
}

function elementTopWithinScrollRoot(
  scrollRoot: ViewerScrollRoot,
  element: ViewerScrollElement,
): number {
  return (
    element.getBoundingClientRect().top -
    scrollRoot.getBoundingClientRect().top +
    scrollRoot.scrollTop
  );
}
