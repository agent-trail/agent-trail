import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../components/landing-page.tsx";
import { readRepoText } from "../content.ts";
import { buildPageMetadata } from "../metadata.ts";
import { buildLandingPageModel } from "../site.ts";

export const Route = createFileRoute("/")({
  head: () => buildPageMetadata({ path: "/" }),
  loader: () => buildLandingPageModel({ readText: readRepoText }),
  component: HomeRoute,
});

function HomeRoute() {
  const model = Route.useLoaderData();
  return <LandingPage model={model} />;
}
