import type { GistViewerModel } from "../gist-viewer.ts";
import type { ViewerShellModel } from "../site.ts";
import { FixedPageScroll, PageIntro } from "./ui.tsx";

type ViewerModel = GistViewerModel | ViewerShellModel;

export function ViewerShell({ model }: { model: ViewerModel }) {
  const title = model.title;
  const statusLabel =
    model.status === "loaded" ? "Loaded" : model.status === "error" ? "Error" : model.status;
  return (
    <FixedPageScroll>
      <section
        className="mx-auto grid w-full max-w-5xl gap-8 px-4 pt-12 pb-16 md:px-8 lg:px-12"
        aria-labelledby="viewer-title"
      >
        <PageIntro eyebrow="viewer" id="viewer-title" title={title}>
          <p className="max-w-[70ch] text-pretty text-base leading-7">{bodyText(model)}</p>
        </PageIntro>
        <dl className="grid max-w-2xl border-t-main">
          <div className="grid gap-2 border-b-main py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-sm text-muted">Gist locator</dt>
            <dd className="m-0 break-words">{model.gistId}</dd>
          </div>
          <div className="grid gap-2 border-b-main py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-sm text-muted">Status</dt>
            <dd className="m-0">{statusLabel}</dd>
          </div>
          {model.status === "loaded" ? <LoadedDetails model={model} /> : null}
        </dl>
        {model.status === "loaded" && model.diagnostics.length > 0 ? (
          <section aria-labelledby="viewer-warnings" className="grid gap-3">
            <h2 id="viewer-warnings" className="text-sm font-bold tracking-[0.18em] uppercase">
              Warnings
            </h2>
            <ul className="m-0 grid gap-2 p-0">
              {model.diagnostics.map((diagnostic) => (
                <li
                  className="list-none border-main px-4 py-3 text-sm"
                  key={`${diagnostic.line}:${diagnostic.path}:${diagnostic.code}`}
                >
                  <span className="font-bold">{diagnostic.code}</span>: {diagnostic.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {model.status === "loaded" ? (
          <pre className="max-h-[28rem] overflow-auto border-main p-4 text-xs leading-5">
            <code>{model.preview}</code>
          </pre>
        ) : null}
      </section>
    </FixedPageScroll>
  );
}

function LoadedDetails({ model }: { model: Extract<GistViewerModel, { status: "loaded" }> }) {
  return (
    <>
      <div className="grid gap-2 border-b-main py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-sm text-muted">Payload file</dt>
        <dd className="m-0 break-words">{model.filename}</dd>
      </div>
      <div className="grid gap-2 border-b-main py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-sm text-muted">Content hash</dt>
        <dd className="m-0 break-words">{model.contentHash ?? "missing"}</dd>
      </div>
      <div className="grid gap-2 border-b-main py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-sm text-muted">Records</dt>
        <dd className="m-0">
          {model.summary.records} records, {model.summary.sessions} sessions,{" "}
          {model.summary.warnings} warnings
        </dd>
      </div>
    </>
  );
}

function bodyText(model: ViewerModel): string {
  if (model.status === "loaded") {
    return "Shared trail loaded, decoded, and checked with reader-tolerant validation.";
  }
  if (model.status === "error") return model.message;
  return model.body;
}
