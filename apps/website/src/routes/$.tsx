import { createFileRoute, Link } from "@tanstack/react-router";
import { buildPageMetadata } from "../metadata.ts";

export const Route = createFileRoute("/$")({
  head: ({ match }) =>
    buildPageMetadata({ path: match.pathname, robots: "noindex", title: "Not Found" }),
  component: NotFoundRoute,
});

function NotFoundRoute() {
  return (
    <main className="min-h-dvh bg-bg px-5 py-8 text-fg sm:px-8">
      <div className="mx-auto flex min-h-[70vh] w-full max-w-[1200px] flex-col justify-between">
        <div>
          <p className="text-[0.68rem] uppercase tracking-[0.42em] text-muted">Not found</p>
          <h1 className="mt-8 max-w-[18ch] text-balance text-3xl font-bold uppercase tracking-[0.08em] sm:text-5xl">
            Route not found
          </h1>
        </div>
        <Link
          className="border-main btn-hover inline-flex w-fit px-6 py-4 text-[0.72rem] font-bold uppercase tracking-[0.22em] no-underline"
          to="/"
        >
          Back home
        </Link>
      </div>
    </main>
  );
}
