import commitMono400Url from "@fontsource/commit-mono/files/commit-mono-latin-400-normal.woff2?url";
import commitMono500Url from "@fontsource/commit-mono/files/commit-mono-latin-500-normal.woff2?url";
import commitMono700Url from "@fontsource/commit-mono/files/commit-mono-latin-700-normal.woff2?url";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteFooter, SiteNav } from "../components/shell.tsx";
import { buildPageMetadata } from "../metadata.ts";
import "../styles.css";

const themeBootScript = `
(() => {
  try {
    const stored = localStorage.getItem("agent-trail-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = stored === "dark" || (stored !== "light" && prefersDark);
    document.documentElement.classList.toggle("dark-mode", dark);
  } catch {
    document.documentElement.classList.remove("dark-mode");
  }
})();
`;

const criticalFontCss = `
@font-face {
  font-family: "Commit Mono";
  font-style: normal;
  font-display: block;
  font-weight: 400;
  src: url("${commitMono400Url}") format("woff2");
}

@font-face {
  font-family: "Commit Mono";
  font-style: normal;
  font-display: block;
  font-weight: 500;
  src: url("${commitMono500Url}") format("woff2");
}

@font-face {
  font-family: "Commit Mono";
  font-style: normal;
  font-display: block;
  font-weight: 700;
  src: url("${commitMono700Url}") format("woff2");
}

html,
body {
  font-family: "Commit Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}
`;

export const Route = createRootRoute({
  head: () => ({
    links: [{ rel: "icon", href: "/favicon.svg" }],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#ffffff", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#000000", media: "(prefers-color-scheme: dark)" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  const chromeState = useRouterState({
    select: (state) => {
      if (state.location.pathname === "/") return "home";
      if (state.location.pathname.startsWith("/spec/")) return "spec";
      if (state.location.pathname.startsWith("/view/")) return "viewer";
      return undefined;
    },
  });

  return (
    <RootDocument>
      <SiteNav current={chromeState} />
      <Outlet />
      <SiteFooter variant={chromeState === "home" ? "home" : "full"} />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href={commitMono400Url}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href={commitMono500Url}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href={commitMono700Url}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Critical font CSS prevents Commit Mono fallback flashes before app CSS loads.
          dangerouslySetInnerHTML={{ __html: criticalFontCss }}
        />
        <HeadContent />
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Inline theme boot avoids a light/dark flash before hydration.
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFoundPage() {
  const metadata = buildPageMetadata({ path: "/", robots: "noindex", title: "Not Found" });

  return (
    <main className="min-h-dvh bg-bg px-5 py-8 text-fg sm:px-8">
      <title>{metadata.meta.find((entry) => "title" in entry)?.title}</title>
      {metadata.meta
        .filter((entry) => "name" in entry || "property" in entry)
        .map((entry) => {
          if ("name" in entry) {
            return <meta content={entry.content} key={entry.name} name={entry.name} />;
          }
          if ("property" in entry) {
            return <meta content={entry.content} key={entry.property} property={entry.property} />;
          }
          return null;
        })}
      <div className="mx-auto flex min-h-[70vh] w-full max-w-[1200px] flex-col justify-between">
        <div>
          <p className="text-[0.68rem] uppercase tracking-[0.42em] text-muted">Not found</p>
          <h1 className="mt-8 max-w-[18ch] text-balance text-3xl font-bold uppercase tracking-[0.08em] sm:text-5xl">
            Route not found
          </h1>
        </div>
        <a
          className="border-main btn-hover inline-flex w-fit px-6 py-4 text-[0.72rem] font-bold uppercase tracking-[0.22em] no-underline"
          href="/"
        >
          Back home
        </a>
      </div>
    </main>
  );
}
