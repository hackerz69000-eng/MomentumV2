import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackStart({
      server: { entry: "server" },
    }),
    viteReact(),
    tailwindcss(),
    nitro({ preset: "vercel" }),
  ],
});
