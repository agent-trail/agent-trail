import { useEffect, useState } from "react";
import { BrandMark, cn, FOCUS_RING, GitHubIcon, RouteLink } from "./ui.tsx";

type ChromeRoute = "home" | "spec" | "viewer";

type ThemeRuntime = {
  document?: {
    body: { classList: Pick<DOMTokenListLike, "toggle"> };
    documentElement: { classList: DOMTokenListLike };
  };
  localStorage?: { setItem: (key: string, value: string) => void };
};

type DOMTokenListLike = {
  contains: (token: string) => boolean;
  toggle: (token: string, force?: boolean) => boolean;
};

const GITHUB_URL = "https://github.com/agent-trail/agent-trail";

function getIsDarkMode() {
  const runtime = globalThis as typeof globalThis & ThemeRuntime;
  const doc = runtime.document;
  if (doc === undefined) return false;
  return doc.documentElement.classList.contains("dark-mode");
}

function toggleTheme() {
  const runtime = globalThis as typeof globalThis & ThemeRuntime;
  const doc = runtime.document;
  if (doc === undefined) return undefined;
  const shouldUseDark = !doc.documentElement.classList.contains("dark-mode");
  doc.documentElement.classList.toggle("dark-mode", shouldUseDark);
  doc.body.classList.toggle("dark-mode", shouldUseDark);
  runtime.localStorage?.setItem("agent-trail-theme", shouldUseDark ? "dark" : "light");
  return shouldUseDark;
}

export function SiteNav({ current }: { current?: ChromeRoute }) {
  if (current !== "home") return <CompactHeader current={current} />;
  return <HomeHeader current={current} />;
}

function CompactHeader({ current }: { current?: ChromeRoute }) {
  const compactLinks = [
    { href: "/", label: "Home", key: "home" },
    { href: "/spec/latest", label: "Read", key: "spec" },
    { href: "/schema/latest.json", label: "Schema", key: "schema" },
    { href: "/spec/latest", label: "Documentation", key: "documentation" },
  ];

  return (
    <header className="site-header fixed-shell-header border-b-main m-0 flex min-h-16 w-full items-center bg-bg px-5 py-3 text-[11px] tracking-[0.28em] uppercase md:px-8">
      <div className="flex w-full flex-wrap items-center gap-x-8 gap-y-3">
        <BrandMark />
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Site routes">
          {compactLinks.map((link) => (
            <HeaderTextLink
              current={current}
              href={link.href}
              key={link.key}
              label={link.label}
              preload={preloadForHref(link.href)}
              routeKey={link.key}
            />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-6 text-muted">
          <span>v0.1.0 / Draft</span>
          <GitHubButton />
        </div>
      </div>
    </header>
  );
}

function HomeHeader({ current }: { current?: ChromeRoute }) {
  const homeLinks = [
    { href: "/spec/latest", label: "Read", key: "spec" },
    { href: "/schema/latest.json", label: "Schema", key: "schema" },
    { href: "/view/gist/example", label: "Viewer", key: "viewer" },
    { href: "/spec/latest", label: "Documentation", key: "documentation" },
  ];

  return (
    <header className="site-header px-4 pt-4 md:px-8 md:pt-8 lg:px-12 lg:pt-12">
      <div className="mx-auto mb-12 flex w-full max-w-5xl items-start justify-between gap-4">
        <BrandMark withMeta />
        <GitHubButton size="large" />
      </div>
      <nav className="mx-auto mb-12 grid w-full max-w-5xl grid-cols-4 border-l-main border-t-main">
        {homeLinks.map((link) => (
          <HomeGridLink
            current={current}
            href={link.href}
            key={link.key}
            label={link.label}
            preload={preloadForHref(link.href)}
            routeKey={link.key}
          />
        ))}
      </nav>
    </header>
  );
}

function HeaderTextLink({
  current,
  href,
  label,
  preload,
  routeKey,
}: {
  current?: ChromeRoute;
  href: string;
  label: string;
  preload?: "intent" | "render" | "viewport";
  routeKey: string;
}) {
  const isCurrent = current === routeKey;
  const className = cn(
    "font-bold hover:text-fg",
    FOCUS_RING,
    isCurrent
      ? "text-fg underline decoration-fg decoration-1 underline-offset-4"
      : "text-muted no-underline",
  );

  return (
    <RouteLink
      ariaCurrent={isCurrent ? "page" : undefined}
      className={className}
      href={href}
      preload={preload}
    >
      {label}
    </RouteLink>
  );
}

function HomeGridLink({
  current,
  href,
  label,
  preload,
  routeKey,
}: {
  current?: ChromeRoute;
  href: string;
  label: string;
  preload?: "intent" | "render" | "viewport";
  routeKey: string;
}) {
  const isCurrent = current === routeKey;
  const className = cn(
    "btn-hover border-b-main border-r-main p-3 text-center text-[10px] font-bold tracking-widest text-fg uppercase no-underline data-[current=true]:bg-fg data-[current=true]:text-bg",
    FOCUS_RING,
  );

  return (
    <RouteLink
      ariaCurrent={isCurrent ? "page" : undefined}
      className={className}
      dataCurrent={isCurrent ? "true" : undefined}
      href={href}
      preload={preload}
    >
      {label}
    </RouteLink>
  );
}

function preloadForHref(href: string) {
  if (href.startsWith("/spec/") || href.startsWith("/view/")) return "render";
  return undefined;
}

export function SiteFooter({ variant }: { variant: "home" | "full" }) {
  const className =
    variant === "home"
      ? "site-footer border-t-main mx-auto mb-4 w-[calc(100%-2rem)] max-w-5xl pt-10 pb-10 text-[10px] text-muted md:mb-8 md:w-[calc(100%-4rem)] lg:mb-12 lg:w-[calc(100%-6rem)]"
      : "site-footer fixed-shell-footer border-t-main flex w-full flex-wrap items-center justify-between gap-x-8 gap-y-3 bg-bg px-5 pt-5 text-[11px] text-muted md:px-8";

  return (
    <footer className={className}>
      <div
        className={
          variant === "home" ? "grid gap-8 md:grid-cols-[1fr_auto] md:items-center" : "contents"
        }
      >
        <div className="grid gap-1">
          <p className="m-0 font-bold tracking-widest text-fg uppercase">
            Agent Trail Specification
          </p>
          <p className="m-0 uppercase">© 2026 Agent Trail / Apache-2.0</p>
        </div>
        <nav
          className="flex flex-wrap items-center gap-x-7 gap-y-2 tracking-wider uppercase"
          aria-label="Footer routes"
        >
          <RouteLink
            className={cn("font-bold no-underline hover:text-fg", FOCUS_RING)}
            href={GITHUB_URL}
          >
            GitHub
          </RouteLink>
          <RouteLink
            className={cn("font-bold no-underline hover:text-fg", FOCUS_RING)}
            href="/spec/latest"
          >
            Documentation
          </RouteLink>
          <RouteLink
            className={cn("font-bold no-underline hover:text-fg", FOCUS_RING)}
            href="/schema/latest.json"
          >
            Schema
          </RouteLink>
          <ThemeModeButton />
        </nav>
      </div>
    </footer>
  );
}

export function ThemeModeButton() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    setIsDarkMode(getIsDarkMode());
  }, []);

  return (
    <button
      aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDarkMode}
      className={cn(
        "border-0 bg-transparent p-0 font-mono text-[11px] font-bold tracking-wider text-muted uppercase hover:text-fg",
        FOCUS_RING,
      )}
      onClick={() => {
        const nextIsDarkMode = toggleTheme();
        if (nextIsDarkMode !== undefined) setIsDarkMode(nextIsDarkMode);
      }}
      type="button"
    >
      {isDarkMode ? "Dark" : "Light"}
    </button>
  );
}

function GitHubButton({ size = "compact" }: { size?: "compact" | "large" }) {
  const className =
    size === "large"
      ? cn(
          "btn-hover border-main inline-flex items-center gap-2 px-4 py-2 text-xs font-bold tracking-tighter text-fg uppercase no-underline",
          FOCUS_RING,
        )
      : cn(
          "btn-hover border-main inline-flex items-center gap-2 px-3 py-1 text-[11px] tracking-tighter text-fg uppercase no-underline",
          FOCUS_RING,
        );

  return (
    <a className={className} href={GITHUB_URL}>
      <GitHubIcon className={size === "large" ? "size-4" : "size-3"} />
      GitHub
    </a>
  );
}
