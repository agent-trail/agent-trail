import { createFileRoute } from "@tanstack/react-router";
import { SpecPage } from "../../components/spec-page.tsx";
import { readRepoText } from "../../content.ts";
import { buildPageMetadata } from "../../metadata.ts";
import { buildSpecPageModel } from "../../site.ts";

export const Route = createFileRoute("/spec/v0.1.0")({
  head: () => buildPageMetadata({ path: "/spec/v0.1.0", title: "Agent Trail Specification" }),
  loader: () => buildSpecPageModel({ readText: readRepoText, routeVersion: "v0.1.0" }),
  component: SpecVersionRoute,
});

function SpecVersionRoute() {
  const model = Route.useLoaderData();
  return <SpecPage model={model} />;
}
