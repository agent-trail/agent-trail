import { createServerFn } from "@tanstack/react-start";
import { buildGistViewerModel } from "./gist-viewer.ts";

export const loadGistViewerModel = createServerFn({ method: "GET" })
  .inputValidator((data: { gistId: string }) => data)
  .handler(async ({ data }) => buildGistViewerModel({ gistId: data.gistId }));
