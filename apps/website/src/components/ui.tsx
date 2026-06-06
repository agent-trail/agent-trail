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
    <RouteLink className="inline-flex flex-col gap-1 no-underline" href="/">
      <span className="border-main inline-block px-2 py-1 text-xs font-bold tracking-widest text-fg uppercase">
        Agent Trail Spec
      </span>
      {withMeta ? (
        <span className="text-[10px] text-muted">v0.1.0 / Draft / Apache-2.0</span>
      ) : null}
    </RouteLink>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[10px] tracking-[0.2em] text-muted uppercase">{children}</p>;
}

export function ArrowGlyph() {
  return (
    <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
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
      <span className="text-xs font-bold tracking-widest uppercase">{label}</span>
      <ArrowGlyph />
    </RouteLink>
  );
}

export function SplitRuleHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mb-12 flex h-px w-full items-center justify-center bg-main">
      <span className="bg-bg px-4 text-[10px] font-bold tracking-[0.4em] text-muted uppercase">
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
