export type DesktopDoctorInput = {
  config: Record<string, unknown>;
  capability: Record<string, unknown>;
  rustSource: string;
  workbenchBuilt: boolean;
};

export function desktopDoctorIssues(input: DesktopDoctorInput): string[] {
  const issues: string[] = [];
  const build = object(input.config.build);
  const app = object(input.config.app);
  const security = object(app.security);
  const bundle = object(input.config.bundle);
  const plugins = input.config.plugins;
  if (build.frontendDist !== "../../workbench/dist") issues.push("frontendDist must point to the Workbench build.");
  if (build.devUrl !== "http://127.0.0.1:4173") issues.push("devUrl must use the loopback Workbench server.");
  if (bundle.active !== false) issues.push("The spike must not create unsigned installers.");
  if (!isObject(plugins) || Object.keys(plugins).length !== 0) issues.push("The first desktop spike must define an empty plugins object.");
  const csp = typeof security.csp === "string" ? security.csp : "";
  for (const required of ["object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src http://127.0.0.1:*"]) {
    if (!csp.includes(required)) issues.push(`Desktop CSP is missing: ${required}`);
  }
  if (/unsafe-eval|https?:\/\/[^\s;*]+/.test(csp.replaceAll("http://127.0.0.1:*", "").replaceAll("http://localhost:*", "").replaceAll("http://[::1]:*", "").replaceAll("http://asset.localhost", "").replaceAll("http://ipc.localhost", ""))) {
    issues.push("Desktop CSP contains an unexpected remote source or unsafe-eval.");
  }
  if (input.capability.identifier !== "default" || !Array.isArray(input.capability.windows) || input.capability.windows.length !== 1 || input.capability.windows[0] !== "main") {
    issues.push("The default capability must target only the main window.");
  }
  if (!Array.isArray(input.capability.permissions) || input.capability.permissions.length !== 0) {
    issues.push("The default capability must expose zero Tauri permissions.");
  }
  if (/invoke_handler|generate_handler!|#\s*\[\s*tauri::command\s*\]|\.plugin\s*\(/.test(input.rustSource)) {
    issues.push("The Rust shell must not register custom commands or plugins.");
  }
  if (!input.workbenchBuilt) issues.push("Workbench dist/index.html is missing.");
  return issues;
}

function object(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
