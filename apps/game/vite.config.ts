import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1", cors: true },
  preview: { host: "127.0.0.1", cors: true },
  build: {
    outDir: "dist",
    manifest: true,
  },
});
