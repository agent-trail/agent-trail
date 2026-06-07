import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 3000,
  },
  preview: {
    host: "127.0.0.1",
  },
  plugins: [
    tanstackStart({
      prerender: {
        enabled: true,
        autoStaticPathsDiscovery: true,
        crawlLinks: true,
        failOnError: true,
      },
      pages: [
        { path: "/", prerender: { enabled: true, outputPath: "/index.html" } },
        {
          path: "/schema/v0.1.0.json",
          prerender: { enabled: true, outputPath: "/schema/v0.1.0.json" },
        },
        {
          path: "/schema/latest.json",
          prerender: { enabled: true, outputPath: "/schema/latest.json" },
        },
        {
          path: "/spec/v0.1.0",
          prerender: { enabled: true, outputPath: "/spec/v0.1.0/index.html" },
        },
        {
          path: "/spec/latest",
          prerender: { enabled: true, outputPath: "/spec/latest/index.html" },
        },
        {
          path: "/view/gist/example",
          prerender: { enabled: true, outputPath: "/view/gist/example/index.html" },
        },
      ],
    }),
    tailwindcss(),
    viteReact(),
  ],
});
