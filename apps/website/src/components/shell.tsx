import type { ThemeName } from "../theme.tsx";
import { useTheme } from "../theme.tsx";
import { BrandMark, cn, FOCUS_RING, GitHubIcon, RouteLink } from "./ui.tsx";

type ChromeRoute = "home" | "spec" | "viewer";

const GITHUB_URL = "https://github.com/agent-trail/agent-trail";

export function SiteNav({ current }: { current?: ChromeRoute }) {
  if (current !== "home") return <CompactHeader current={current} />;
  return <HomeHeader current={current} />;
}

function CompactHeader({ current }: { current?: ChromeRoute }) {
  const compactLinks = [
    { href: "/spec/latest", label: "Spec", key: "spec" },
    { href: "/schema/latest.json", label: "Schema", key: "schema" },
    { href: "/view/gist/example", label: "Viewer", key: "viewer" },
    { href: "/spec/latest", label: "Documentation", key: "documentation" },
  ];

  return (
    <header className="site-header fixed-shell-header border-b-main m-0 flex min-h-16 w-full items-center bg-bg px-5 py-3 text-[11px] tracking-[0.28em] uppercase md:px-8">
      <div className="flex w-full flex-wrap items-center gap-x-8 gap-y-3">
        <BrandMark withMeta />
        <div className="ml-auto flex flex-wrap items-center gap-x-8 gap-y-3">
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
          <GitHubButton />
        </div>
      </div>
    </header>
  );
}

function HomeHeader({ current }: { current?: ChromeRoute }) {
  const homeLinks = [
    { href: "/spec/latest", label: "Spec", key: "spec" },
    { href: "/schema/latest.json", label: "Schema", key: "schema" },
    { href: "/view/gist/example", label: "Viewer", key: "viewer" },
    { href: "/spec/latest", label: "Documentation", key: "documentation" },
  ];

  return (
    <header className="site-header px-4 pt-4 md:px-8 md:pt-8 lg:px-12 lg:pt-12">
      <div className="mx-auto mb-12 flex w-full max-w-5xl items-center justify-between gap-4">
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
    "hit-area-40 relative inline-flex items-center font-bold hover:text-fg",
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
    "btn-hover border-b-main border-r-main p-3 text-center text-xs font-bold tracking-widest text-fg uppercase no-underline data-[current=true]:bg-fg data-[current=true]:text-bg",
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
      ? "site-footer border-t-main mx-auto mb-4 w-[calc(100%-2rem)] max-w-5xl pt-10 pb-10 text-xs text-muted md:mb-8 md:w-[calc(100%-4rem)] lg:mb-12 lg:w-[calc(100%-6rem)]"
      : "site-footer fixed-shell-footer border-t-main flex w-full flex-wrap items-center justify-between gap-x-8 gap-y-3 bg-bg px-5 pt-5 text-xs text-muted md:px-8";

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
        <nav className="flex flex-wrap items-center gap-x-7 gap-y-2" aria-label="Theme">
          <ThemeSwitcher />
        </nav>
      </div>
    </footer>
  );
}

export function ThemeSwitcher() {
  const { setTheme, theme, themes } = useTheme();
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="sr-only">Theme</legend>
      <div className="border-main inline-grid grid-cols-3 bg-accent p-0.5">
        {themes.map((option) => {
          const isActive = theme === option;
          return (
            <button
              aria-label={`Use ${option} theme`}
              aria-pressed={isActive}
              className={cn(
                "hit-area-40 inline-flex min-h-8 min-w-10 items-center justify-center gap-1.5 px-2 py-1 font-mono text-[11px] font-bold tracking-tight uppercase",
                "border-0 bg-transparent text-muted hover:text-fg",
                isActive && "bg-fg text-bg hover:text-bg",
                FOCUS_RING,
              )}
              key={option}
              onClick={() => setTheme(option)}
              type="button"
            >
              <ThemeGlyph theme={option} />
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ThemeGlyph({ theme }: { theme: ThemeName }) {
  const className = "size-3 shrink-0";
  if (theme === "light") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M8 1.25v2M8 12.75v2M1.25 8h2M12.75 8h2M3 3l1.4 1.4M11.6 11.6 13 13M13 3l-1.4 1.4M4.4 11.6 3 13"
          stroke="currentColor"
          strokeLinecap="square"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (theme === "dark") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 16 16">
        <path
          d="M12.5 10.4A5.5 5.5 0 0 1 5.6 3.5 5.7 5.7 0 1 0 12.5 10.4Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 16 16">
      <path
        d="m8 1.8 1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6l4-.6L8 1.8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
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
