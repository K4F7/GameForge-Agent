export function openChamberExternalEnvironment(codeArtsServerUrl: string): Readonly<Record<string, string>> {
  return {
    OPENCODE_HOST: new URL(codeArtsServerUrl).origin,
    OPENCODE_SKIP_START: "true",
  };
}

export async function registerOpenChamberDirectory(
  openChamberUrl: string,
  projectDirectory: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 5_000;
  let registration: Response;
  try {
    registration = await fetch(new URL("api/opencode/directory", openChamberUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: projectDirectory }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeout(error)) throw new Error(`OpenChamber project registration timed out after ${timeoutMs}ms.`);
    throw error;
  }
  if (!registration.ok) {
    throw new Error(`OpenChamber project registration failed with HTTP ${registration.status}.`);
  }

  let settingsResponse: Response;
  try {
    settingsResponse = await fetch(new URL("api/config/settings", openChamberUrl), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (isTimeout(error)) throw new Error(`OpenChamber settings verification timed out after ${timeoutMs}ms.`);
    throw error;
  }
  if (!settingsResponse.ok) {
    throw new Error(`OpenChamber settings verification failed with HTTP ${settingsResponse.status}.`);
  }
  const settings: unknown = await settingsResponse.json();
  if (!hasRegisteredProject(settings, projectDirectory)) {
    throw new Error(`OpenChamber did not persist the registered project directory: ${projectDirectory}`);
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function hasRegisteredProject(value: unknown, projectDirectory: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as { lastDirectory?: unknown; activeProjectId?: unknown; projects?: unknown };
  if (typeof settings.lastDirectory !== "string" || !sameDirectory(settings.lastDirectory, projectDirectory)
    || typeof settings.activeProjectId !== "string" || !Array.isArray(settings.projects)) return false;
  return settings.projects.some((project) => typeof project === "object" && project !== null
    && (project as { id?: unknown }).id === settings.activeProjectId
    && typeof (project as { path?: unknown }).path === "string"
    && sameDirectory((project as { path: string }).path, projectDirectory));
}

function sameDirectory(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
import path from "node:path";
