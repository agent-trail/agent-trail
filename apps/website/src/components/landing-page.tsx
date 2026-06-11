import type { LandingPageModel } from "../site.ts";
import { TrailArtifact } from "./trail-artifact.tsx";
import {
  ArrowGlyph,
  BorderedActionLink,
  BrandInlineLockup,
  cn,
  Eyebrow,
  FOCUS_RING,
  RouteLink,
  SplitRuleHeading,
} from "./ui.tsx";

export function LandingPage({ model }: { model: LandingPageModel }) {
  const highlightedSummary = highlightedAgentTrailSummary(model.summary);

  return (
    <main className="bg-bg text-fg">
      <div className="px-4 pb-4 md:px-8 md:pb-8 lg:px-12 lg:pb-12">
        <div className="mx-auto w-full max-w-5xl flex-grow">
          <section
            className="mb-24 grid grid-cols-1 gap-8 lg:grid-cols-12"
            aria-labelledby="home-title"
          >
            <div className="flex flex-col justify-between py-2 lg:col-span-5">
              <div>
                <div className="mb-4">
                  <Eyebrow>{"// Introduction"}</Eyebrow>
                </div>
                <h1 id="home-title" className="sr-only">
                  {model.title}
                </h1>
                <p className="text-pretty text-xl leading-relaxed font-light md:text-2xl">
                  {highlightedSummary}
                </p>
              </div>
              <nav className="mt-12 flex flex-col gap-4" aria-label="Core routes">
                {model.primaryLinks.map((link) => (
                  <BorderedActionLink
                    href={link.href}
                    key={link.href}
                    label={link.label}
                    preload={preloadForHref(link.href)}
                  />
                ))}
              </nav>
            </div>
            <div className="flex lg:col-span-7">
              <TrailArtifact code={model.codePreview} />
            </div>
          </section>

          <SplitRuleHeading>Reference Implementations</SplitRuleHeading>

          <section
            className="grid grid-cols-1 border-l-main border-t-main md:grid-cols-2 lg:grid-cols-5"
            aria-labelledby="reference-title"
          >
            <h2 id="reference-title" className="sr-only">
              Reference implementations
            </h2>
            {model.referenceImplementations.map((surface, index) => (
              <RouteLink
                className={cn(
                  "btn-hover group flex min-h-56 flex-col gap-8 border-b-main border-r-main p-6 no-underline",
                  FOCUS_RING,
                )}
                href={surface.href}
                key={surface.name}
                preload={preloadForHref(surface.href)}
              >
                <span className="text-xs text-muted group-hover:text-bg">
                  [ {String(index + 1).padStart(2, "0")} ]
                </span>
                <div className="flex-grow">
                  <h3 className="mb-1 text-base font-bold uppercase">{surface.name}</h3>
                  <p className="text-xs opacity-70">{surface.packageLabel}</p>
                  <p className="mt-3 text-xs tracking-widest uppercase opacity-70">
                    {surface.status}
                  </p>
                </div>
                <div className="text-sm">
                  <ArrowGlyph />
                </div>
              </RouteLink>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}

function highlightedAgentTrailSummary(summary: string) {
  const prefix = "Agent Trail";
  if (!summary.startsWith(prefix)) return summary;

  return (
    <>
      <span className="mr-3 inline align-baseline">
        <BrandInlineLockup label="AGENT_TRAIL" />
      </span>
      {summary.slice(prefix.length)}
    </>
  );
}

function preloadForHref(href: string) {
  if (href.startsWith("/spec/") || href.startsWith("/view/")) return "render";
  return undefined;
}
