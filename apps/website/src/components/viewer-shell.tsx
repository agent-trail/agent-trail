import type { ViewerShellModel } from "../site.ts";
import { FixedPageScroll, PageIntro } from "./ui.tsx";

export function ViewerShell({ model }: { model: ViewerShellModel }) {
  return (
    <FixedPageScroll>
      <section
        className="mx-auto grid w-full max-w-5xl gap-8 px-4 pt-12 pb-16 md:px-8 lg:px-12"
        aria-labelledby="viewer-title"
      >
        <PageIntro eyebrow="viewer route shell" id="viewer-title" title={model.title}>
          <p className="max-w-[70ch] text-pretty text-base leading-7">{model.body}</p>
        </PageIntro>
        <dl className="grid max-w-2xl border-t-main">
          <div className="grid gap-2 border-b-main py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-sm text-muted">Gist locator</dt>
            <dd className="m-0 break-words">{model.gistId}</dd>
          </div>
          <div className="grid gap-2 border-b-main py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-sm text-muted">Status</dt>
            <dd className="m-0">{model.status}</dd>
          </div>
        </dl>
      </section>
    </FixedPageScroll>
  );
}
