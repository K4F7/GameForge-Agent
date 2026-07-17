import path from "node:path";

export type CodeArtsLaunchTarget = {
  executable: string;
  command: string;
  kind: "direct" | "cmd-shim";
};

export type CodeArtsSpawnCommand = { command: string; args: string[]; windowsVerbatimArguments: boolean };

export async function resolveCodeArtsLaunchTarget(options: {
  home: string;
  platform?: NodeJS.Platform;
  configured?: string;
  comspec?: string;
  access?: (target: string) => Promise<void>;
}): Promise<CodeArtsLaunchTarget> {
  const platform = options.platform ?? process.platform;
  const configured = options.configured?.trim();
  if (configured) return launchTarget(configured, platform, options.comspec);
  if (platform !== "win32") return launchTarget("codearts", platform, options.comspec);

  const access = options.access ?? (async (target: string) => {
    const fs = await import("node:fs/promises");
    const info = await fs.stat(target);
    if (!info.isFile()) throw Object.assign(new Error("CodeArts candidate is not a file."), { code: "EISDIR" });
  });
  const pathApi = platform === "win32" ? path.win32 : path;
  const installers = pathApi.join(options.home, ".codeartsdoer", "installers");
  const candidates = [pathApi.join(installers, "bin", "codearts.exe"), pathApi.join(installers, "codearts.cmd")];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return launchTarget(candidate, platform, options.comspec);
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
  }
  throw new Error(`CodeArts was not found under ${installers}. Set CODEARTS_BIN explicitly.`);
}

function launchTarget(executable: string, platform: NodeJS.Platform, comspec?: string): CodeArtsLaunchTarget {
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
    return {
      executable,
      command: comspec?.trim() || "cmd.exe",
      kind: "cmd-shim",
    };
  }
  return { executable, command: executable, kind: "direct" };
}

export function codeArtsSpawnCommand(target: CodeArtsLaunchTarget, clientArgs: ReadonlyArray<string>): CodeArtsSpawnCommand {
  if (target.kind === "direct") {
    return { command: target.command, args: [...clientArgs], windowsVerbatimArguments: false };
  }
  const commandLine = `call ${[target.executable, ...clientArgs].map(quoteCmdArgument).join(" ")}`;
  return { command: target.command, args: ["/d", "/s", "/c", commandLine], windowsVerbatimArguments: true };
}

function quoteCmdArgument(value: string): string {
  if (/[\r\n"%!^&|<>()]/.test(value)) {
    throw new Error("CodeArts cmd shim arguments cannot contain Windows command-shell metacharacters; set CODEARTS_BIN to the executable.");
  }
  return `"${value}"`;
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
