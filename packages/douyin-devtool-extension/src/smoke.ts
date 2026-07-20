import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
  const installedExtensionDirectory = resolve(
    extensionsDirectory,
    "gameforge.gameforge-douyin-devtool-extension-0.1.0",
  );
  const token = randomBytes(32).toString("hex");
  const useExistingProfile = process.env.GAMEFORGE_DOUYIN_SMOKE_USE_EXISTING_PROFILE === "1";
  const installedExtensionsDirectory = process.env.GAMEFORGE_DOUYIN_SMOKE_EXTENSIONS_DIR;
  await mkdir(installedExtensionDirectory, { recursive: true });
  await cp(resolve(extensionRoot, "package.json"), resolve(installedExtensionDirectory, "package.json"));
  await cp(resolve(extensionRoot, "dist"), resolve(installedExtensionDirectory, "dist"), { recursive: true });
  await cp(resolve(extensionRoot, "README.md"), resolve(installedExtensionDirectory, "README.md"));
  await cp(
    resolve(extensionRoot, "THIRD_PARTY_NOTICES.md"),
    resolve(installedExtensionDirectory, "THIRD_PARTY_NOTICES.md"),
  );
  await writeFile(
    resolve(extensionsDirectory, "extensions.json"),
    JSON.stringify([createExtensionRegistryEntry(installedExtensionDirectory)]),
    "utf8",
  );

  const result = await new Promise<{ hello: Record<string, unknown>; status: Record<string, unknown> }>(
    (resolveResult, reject) => {
      let child: ReturnType<typeof spawn> | undefined;
      let hello: Record<string, unknown> | undefined;
      let status: Record<string, unknown> | undefined;
      let buffer = "";
      let settled = false;
      const finish = (value: { hello: Record<string, unknown>; status: Record<string, unknown> }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.close();
        terminateProcessTree(child).finally(() => resolveResult(value));
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.close();
        const failure = error instanceof Error ? error : new Error(String(error));
        terminateProcessTree(child).finally(() => reject(failure));
      };
      const server = createServer((socket) => {
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            let parsed: Record<string, unknown>;
            try {
              const value = JSON.parse(line) as unknown;
              if (typeof value !== "object" || value === null || Array.isArray(value)) {
                throw new Error("The extension smoke probe received a non-object handshake message.");
              }
              parsed = value as Record<string, unknown>;
            } catch (error) {
              fail(new Error(`The extension smoke probe received invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
              return;
            }
            if (parsed.type === "hello") hello = parsed;
            if (parsed.type === "status") status = parsed;
            if (hello !== undefined && status !== undefined) finish({ hello, status });
          }
        });
        socket.once("error", fail);
        socket.once("end", () => {
          if (!settled && (hello === undefined || status === undefined)) {
            fail(new Error("The extension bridge socket closed before the handshake completed."));
          }
        });
      });

      const timeout = setTimeout(() => {
        fail(new Error("Timed out waiting for the Douyin DevTool extension handshake."));
      }, 30_000);
      timeout.unref();

      server.on("error", fail);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          fail(new Error("Failed to allocate the local bridge port."));
          return;
        }
        const profileArguments = useExistingProfile
          ? [`--extensions-dir=${resolve(installedExtensionsDirectory ?? extensionsDirectory)}`]
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
        child.once("error", fail);
        child.once("exit", (code) => {
          if (!settled && code !== 0) {
            fail(new Error(`The Douyin DevTool smoke process exited before handshake (code ${String(code)}).`));
          }
        });
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

function createExtensionRegistryEntry(extensionDirectory: string): Record<string, unknown> {
  const extensionUri = pathToFileURL(extensionDirectory);
  return {
    identifier: { id: "gameforge.gameforge-douyin-devtool-extension" },
    version: "0.1.0",
    location: {
      $mid: 1,
      fsPath: extensionDirectory,
      external: extensionUri.href,
      path: extensionUri.pathname,
      scheme: "file",
    },
    relativeLocation: "gameforge.gameforge-douyin-devtool-extension-0.1.0",
    metadata: {
      isApplicationScoped: false,
      isMachineScoped: false,
      isBuiltin: false,
      installedTimestamp: Date.now(),
      pinned: true,
      source: "vsix",
    },
  };
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
