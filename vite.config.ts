import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      // Keep the project's SSR error wrapper as the TanStack server entry.
      server: { entry: "./server.ts" },
    }),
    nitro(),
    viteReact(),
    tsconfigPaths(),
  ],
});
