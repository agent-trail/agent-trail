import { createFileRoute } from "@tanstack/react-router";
import { readRepoText } from "../../content.ts";
import { buildSchemaResponse } from "../../site.ts";

export const Route = createFileRoute("/schema/latest.json")({
  server: {
    handlers: {
      GET: async () => {
        const schema = await buildSchemaResponse({
          readText: readRepoText,
          routeVersion: "latest",
        });
        return new Response(schema.body, {
          headers: { "Content-Type": schema.contentType },
        });
      },
    },
  },
});
