import { createFileRoute } from "@tanstack/react-router";
import { readRepoText } from "../../content.ts";
import { buildSchemaResponse } from "../../site.ts";

export const Route = createFileRoute("/schema/v0.1.0.json")({
  server: {
    handlers: {
      GET: async () => {
        const schema = await buildSchemaResponse({
          readText: readRepoText,
          routeVersion: "v0.1.0",
        });
        return new Response(schema.body, {
          headers: { "Content-Type": schema.contentType },
        });
      },
    },
  },
});
