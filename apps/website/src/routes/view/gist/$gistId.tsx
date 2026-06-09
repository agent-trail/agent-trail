import { createFileRoute } from "@tanstack/react-router";
import { ViewerShell } from "../../../components/viewer-shell.tsx";
import { loadGistViewerModel } from "../../../gist-viewer-server.ts";
import { buildPageMetadata } from "../../../metadata.ts";

export const Route = createFileRoute("/view/gist/$gistId")({
  loader: ({ params }) => loadGistViewerModel({ data: { gistId: params.gistId } }),
  head: ({ params }) =>
    buildPageMetadata({
      path: `/view/gist/${encodeURIComponent(params.gistId)}`,
      title: "Trail Viewer",
    }),
  component: ViewerRoute,
});

function ViewerRoute() {
  const model = Route.useLoaderData();
  return <ViewerShell model={model} />;
}
