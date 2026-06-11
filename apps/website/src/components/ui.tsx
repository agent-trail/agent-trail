import { Link } from "@tanstack/react-router";
import { type ClassValue, clsx } from "clsx";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-fg";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function isDocumentHref(href: string) {
  return isExternalHref(href) || href.endsWith(".json");
}

function isExternalHref(href: string) {
  return href.startsWith("http");
}

export function RouteLink({
  ariaCurrent,
  children,
  className,
  dataCurrent,
  href,
  preload,
}: {
  ariaCurrent?: "page";
  children: ReactNode;
  className?: string;
  dataCurrent?: "true";
  href: string;
  preload?: "intent" | "render" | "viewport";
}) {
  if (isDocumentHref(href)) {
    return (
      <a
        aria-current={ariaCurrent}
        className={className}
        data-current={dataCurrent}
        href={href}
        rel={isExternalHref(href) ? "noreferrer" : undefined}
        target={isExternalHref(href) ? "_blank" : undefined}
      >
        {children}
      </a>
    );
  }

  return (
    <Link
      aria-current={ariaCurrent}
      className={className}
      data-current={dataCurrent}
      preload={preload}
      to={href}
    >
      {children}
    </Link>
  );
}

export function BrandMark({ withMeta = false }: { withMeta?: boolean }) {
  return (
    <RouteLink className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 no-underline" href="/">
      <BrandLockup className="text-sm" />
      {withMeta ? (
        <span className="text-xs tracking-normal text-muted normal-case">
          v0.1.0 / Draft / Apache-2.0
        </span>
      ) : null}
    </RouteLink>
  );
}

export function BrandLockup({
  className,
  label = "AGENT_TRAIL",
  showTrail = true,
}: {
  className?: string;
  label?: string;
  showTrail?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-[0.62em] leading-none", className)}>
      <BrandPrompt className="h-[1.55em] w-[2.48em] shrink-0" />
      <BrandWordmark label={label} />
      {showTrail ? (
        <BrandTrailEnd className="hidden h-[0.8em] w-[3.2em] shrink-0 sm:block" />
      ) : null}
    </span>
  );
}

export function BrandInlineLockup({
  className,
  label = "AGENT_TRAIL",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-[0.44em] align-baseline leading-none",
        className,
      )}
    >
      <BrandPrompt className="h-[0.95em] w-[1.52em] translate-y-[0.08em] shrink-0" />
      <BrandWordmark className="text-[0.82em]" label={label} />
    </span>
  );
}

export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 120 48"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 10L30 24L12 38" stroke="currentColor" strokeWidth="6" />
      <path d="M36 38H58" stroke="currentColor" strokeWidth="6" />
      <path d="M70 24H100" stroke="currentColor" strokeWidth="5" />
      <rect height="13" width="13" x="100" y="17.5" stroke="currentColor" strokeWidth="5" />
    </svg>
  );
}

export function BrandWordmark({ className, label }: { className?: string; label: string }) {
  return (
    <span
      className={cn("inline-block leading-none font-bold tracking-[0.18em] uppercase", className)}
    >
      {label}
    </span>
  );
}

function BrandPrompt({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 64 40"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M10 8L28 20L10 32" stroke="currentColor" strokeWidth="6" />
      <path d="M36 32H58" stroke="currentColor" strokeWidth="6" />
    </svg>
  );
}

function BrandTrailEnd({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 72 18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 9H52" stroke="currentColor" strokeWidth="4" />
      <rect height="10" width="10" x="52" y="4" stroke="currentColor" strokeWidth="4" />
    </svg>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="m-0 text-xs tracking-[0.2em] text-muted uppercase">{children}</p>;
}

export function ArrowGlyph() {
  return (
    <span aria-hidden="true" className="arrow-glyph transition-transform group-hover:translate-x-1">
      -&gt;
    </span>
  );
}

export function BorderedActionLink({
  href,
  label,
  preload,
}: {
  href: string;
  label: string;
  preload?: "intent" | "render" | "viewport";
}) {
  return (
    <RouteLink
      className={cn(
        "btn-hover border-main group flex items-center justify-between p-4 no-underline",
        FOCUS_RING,
      )}
      href={href}
      preload={preload}
    >
      <span className="text-sm font-bold tracking-widest uppercase">{label}</span>
      <ArrowGlyph />
    </RouteLink>
  );
}

export function SplitRuleHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mb-12 flex h-px w-full items-center justify-center bg-main">
      <span className="bg-bg px-4 text-xs font-bold tracking-[0.4em] text-muted uppercase">
        {children}
      </span>
    </div>
  );
}

export function FixedPageScroll({ children }: { children: ReactNode }) {
  return (
    <main className="fixed-page-scroll bg-bg text-fg" id="page-content">
      {children}
    </main>
  );
}

export function PageIntro({
  children,
  eyebrow,
  id,
  title,
}: {
  children?: ReactNode;
  eyebrow: string;
  id?: string;
  title: string;
}) {
  return (
    <header className="grid gap-4 border-b-main pb-10">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 id={id} className="text-balance text-4xl leading-tight font-bold sm:text-5xl">
        {title}
      </h1>
      {children}
    </header>
  );
}

export function GitHubIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 16 16">
      <path d="M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.63 5.47 7.71.4.08.55-.18.55-.39 0-.19-.01-.83-.01-1.5-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.96-.82-1.15-.28-.15-.68-.53-.01-.54.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.91-3.64-4.02 0-.89.31-1.62.82-2.19-.08-.21-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.43 7.43 0 0 1 8 3.92c.68 0 1.36.09 2 .27 1.53-1.06 2.2-.84 2.2-.84.44 1.12.16 1.95.08 2.16.51.57.82 1.3.82 2.19 0 3.12-1.9 3.81-3.71 4.02.29.25.55.76.55 1.55 0 1.12-.01 2.02-.01 2.3 0 .21.15.47.55.39A8.08 8.08 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z" />
    </svg>
  );
}
