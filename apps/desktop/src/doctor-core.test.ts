import { describe, expect, it } from "vitest";
import { desktopDoctorIssues } from "./doctor-core.js";

const valid = {
  config: {
    build: { frontendDist: "../../workbench/dist", devUrl: "http://127.0.0.1:4173" },
    app: { security: { csp: "object-src 'none'; base-uri 'none'; form-action 'none'; frame-src http://127.0.0.1:*" } },
    bundle: { active: false },
    plugins: {},
  },
  capability: { identifier: "default", windows: ["main"], permissions: [] },
  rustSource: "tauri::Builder::default().run(tauri::generate_context!())",
  workbenchBuilt: true,
};

describe("desktop doctor", () => {
  it("accepts a zero-permission shell", () => expect(desktopDoctorIssues(valid)).toEqual([]));
  it("rejects plugins, permissions, and missing frontend output", () => {
    expect(desktopDoctorIssues({
      ...valid,
      config: { ...valid.config, plugins: { shell: {} } },
      capability: { permissions: ["shell:allow-open"] },
      rustSource: ".plugin(shell())",
      workbenchBuilt: false,
    })).toEqual(expect.arrayContaining([
      "The first desktop spike must define an empty plugins object.",
      "The default capability must expose zero Tauri permissions.",
      "The Rust shell must not register custom commands or plugins.",
      "Workbench dist/index.html is missing.",
    ]));
  });

  it("rejects malformed plugin and capability shapes", () => {
    expect(desktopDoctorIssues({
      ...valid,
      config: { ...valid.config, plugins: [] },
      capability: { identifier: "other", windows: ["other"], permissions: [] },
      rustSource: "#[tauri::command] fn status() {} tauri::generate_handler![status]",
    })).toEqual(expect.arrayContaining([
      "The first desktop spike must define an empty plugins object.",
      "The default capability must target only the main window.",
      "The Rust shell must not register custom commands or plugins.",
    ]));
  });
});
