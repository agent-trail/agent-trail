import { createFileRoute } from "@tanstack/react-router";
import { ViewerShell } from "../../../components/viewer-shell.tsx";
import { buildPageMetadata } from "../../../metadata.ts";
import { buildViewerShellModel } from "../../../site.ts";

export const Route = createFileRoute("/view/gist/$gistId")({
  loader: ({ params }) => buildViewerShellModel({ gistId: params.gistId }),
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
