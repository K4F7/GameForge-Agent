import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { configuredPreviewOrigins, workbenchCsp } from "./src/preview-security.js";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ".", "");
  const csp = workbenchCsp({
    previewOrigins: configuredPreviewOrigins(env.VITE_GAME_PREVIEW_ORIGINS),
    ...(env.VITE_AGENT_BASE_URL === undefined ? {} : { relayUrl: env.VITE_AGENT_BASE_URL }),
    allowDevScripts: command === "serve" && mode === "development",
    allowDevStyles: command === "serve" && mode === "development",
  });
  const headers = {
    "Content-Security-Policy": `${csp}; frame-ancestors 'none'`,
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  const cspPlugin: Plugin = {
    name: "gameforge-workbench-csp",
    transformIndexHtml: {
      order: "pre",
      handler: () => [{
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: csp },
        injectTo: "head-prepend",
      }],
    },
  };
  return {
    base: "./",
    plugins: [cspPlugin, react()],
    server: { host: "127.0.0.1", port: 4173, headers },
    preview: { host: "127.0.0.1", headers },
    build: { outDir: "dist", manifest: true },
  };
});
