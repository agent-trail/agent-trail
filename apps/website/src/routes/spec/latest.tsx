import { createFileRoute } from "@tanstack/react-router";
import { SpecPage } from "../../components/spec-page.tsx";
import { readRepoText } from "../../content.ts";
import { buildPageMetadata } from "../../metadata.ts";
import { buildSpecPageModel } from "../../site.ts";

export const Route = createFileRoute("/spec/latest")({
  head: () => buildPageMetadata({ path: "/spec/latest", title: "Agent Trail Specification" }),
  loader: () => buildSpecPageModel({ readText: readRepoText, routeVersion: "latest" }),
  component: SpecLatestRoute,
});

function SpecLatestRoute() {
  const model = Route.useLoaderData();
  return <SpecPage model={model} />;
}
