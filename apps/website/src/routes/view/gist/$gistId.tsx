import { createFileRoute } from "@tanstack/react-router";
import { ViewerShell } from "../../../components/viewer-shell.tsx";
import { buildGistViewerModel } from "../../../gist-viewer.ts";
import { buildPageMetadata } from "../../../metadata.ts";

export const Route = createFileRoute("/view/gist/$gistId")({
  loader: ({ params }) => buildGistViewerModel({ gistId: params.gistId }),
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
