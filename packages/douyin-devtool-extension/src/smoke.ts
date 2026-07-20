import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { BRIDGE_PROTOCOL_VERSION } from "./protocol.js";

async function main(): Promise<void> {
  const executable = process.env.GAMEFORGE_DOUYIN_DEVTOOL_EXE;
  if (executable === undefined || executable.trim() === "") {
    throw new Error("GAMEFORGE_DOUYIN_DEVTOOL_EXE must point to the official Douyin DevTool executable.");
  }
  const cliEntry = process.env.GAMEFORGE_DOUYIN_DEVTOOL_CLI;
  if (cliEntry === undefined || cliEntry.trim() === "") {
    throw new Error("GAMEFORGE_DOUYIN_DEVTOOL_CLI must point to the bundled Code OSS cli.js entry.");
  }

  const extensionRoot = resolve(__dirname, "..");
  const workspaceRoot = resolve(process.env.GAMEFORGE_DOUYIN_SMOKE_PROJECT ?? resolve(extensionRoot, "../.."));
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "gameforge-douyin-extension-smoke-"));
  const userDataDirectory = resolve(temporaryRoot, "user-data");
  const extensionsDirectory = resolve(temporaryRoot, "extensions");
  const installedExtensionDirectory = resolve(extensionsDirectory, "gameforge.douyin-devtool-extension-0.1.0");
  const token = randomBytes(32).toString("hex");
  const useExistingProfile = process.env.GAMEFORGE_DOUYIN_SMOKE_USE_EXISTING_PROFILE === "1";
  const installedExtensionsDirectory = process.env.GAMEFORGE_DOUYIN_SMOKE_EXTENSIONS_DIR;
  await mkdir(installedExtensionDirectory, { recursive: true });
  await cp(resolve(extensionRoot, "package.json"), resolve(installedExtensionDirectory, "package.json"));
  await cp(resolve(extensionRoot, "dist"), resolve(installedExtensionDirectory, "dist"), { recursive: true });

  const result = await new Promise<{ hello: Record<string, unknown>; status: Record<string, unknown> }>(
    (resolveResult, reject) => {
      let child: ReturnType<typeof spawn> | undefined;
      let hello: Record<string, unknown> | undefined;
      let status: Record<string, unknown> | undefined;
      let buffer = "";
      let settled = false;
      const server = createServer((socket) => {
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed.type === "hello") hello = parsed;
            if (parsed.type === "status") status = parsed;
            if (!settled && hello !== undefined && status !== undefined) {
              settled = true;
              clearTimeout(timeout);
              server.close();
              terminateProcessTree(child).finally(() => resolveResult({ hello: hello!, status: status! }));
            }
          }
        });
      });

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        server.close();
        terminateProcessTree(child).finally(() =>
          reject(new Error("Timed out waiting for the Douyin DevTool extension handshake.")),
        );
      }, 30_000);
      timeout.unref();

      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("Failed to allocate the local bridge port."));
          return;
        }
        const profileArguments = useExistingProfile
          ? [
              ...(installedExtensionsDirectory === undefined
                ? []
                : [`--extensions-dir=${resolve(installedExtensionsDirectory)}`]),
            ]
          : [`--user-data-dir=${userDataDirectory}`, `--extensions-dir=${extensionsDirectory}`];
        child = spawn(executable, [cliEntry, ...profileArguments, "--preserve-env", "--new-window", "--wait", workspaceRoot], {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            GAMEFORGE_DOUYIN_BRIDGE_AUTOCONNECT: "1",
            GAMEFORGE_DOUYIN_BRIDGE_TOKEN: token,
            GAMEFORGE_DOUYIN_BRIDGE_PORT: String(address.port),
          },
          stdio: "ignore",
          windowsHide: true,
          cwd: dirname(executable),
        });
        child.once("error", reject);
      });
    },
  ).finally(async () => {
    const resolvedTemporaryRoot = resolve(temporaryRoot);
    if (!resolvedTemporaryRoot.startsWith(resolve(tmpdir()))) {
      throw new Error("Refusing to remove a temporary directory outside the system temp root.");
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    await rm(resolvedTemporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  });

  if (
    result.hello.protocolVersion !== BRIDGE_PROTOCOL_VERSION ||
    result.hello.devtool !== "douyin" ||
    result.hello.token !== token
  ) {
    throw new Error("The extension returned an invalid hello message.");
  }
  if (result.status.remoteOperations !== "forbidden") {
    throw new Error("The extension did not preserve the remote-operation safety boundary.");
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      protocolVersion: result.hello.protocolVersion,
      extensionVersion: result.hello.extensionVersion,
      capabilities: result.status.capabilities,
      remoteOperations: result.status.remoteOperations,
    })}\n`,
  );
}

async function terminateProcessTree(child: ReturnType<typeof spawn> | undefined): Promise<void> {
  if (child?.pid === undefined) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolveTermination) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("close", () => resolveTermination());
      killer.once("error", () => resolveTermination());
    });
    return;
  }
  child.kill("SIGTERM");
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
