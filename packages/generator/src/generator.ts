import {
  generatedProjectPlanSchema,
  projectGenerationRequestSchema,
  projectGenerationResultSchema,
  type GameSpec,
  type GeneratedProjectPlan,
  type ProjectGenerationRequest,
  type ProjectGenerationResult,
} from "@gameforge/contracts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createIndexHtml, runtimeSource } from "./template.js";

const GENERATOR_VERSION = "0.6.0";
const MAX_PROJECT_BYTES = 2 * 1024 * 1024;

type GeneratedFile = { path: string; content: string; bytes: number; sha256: string };

export type GameProjectGeneratorOptions = {
  outputRoot: string;
};

export class GameProjectGenerator {
  readonly #outputRoot: string;

  constructor(options: GameProjectGeneratorOptions) {
    if (!path.isAbsolute(options.outputRoot)) {
      throw new Error("Game project output root must be an absolute path.");
    }
    const normalized = path.resolve(options.outputRoot);
    if (path.parse(normalized).root === normalized) {
      throw new Error("Game project output root cannot be a filesystem root.");
    }
    this.#outputRoot = normalized;
  }

  async execute(request: ProjectGenerationRequest): Promise<ProjectGenerationResult> {
    const input = projectGenerationRequestSchema.parse(request);
    const generated = createGeneratedFiles(input.projectId, input.spec);
    const plan = generatedProjectPlanSchema.parse({
      generatorVersion: GENERATOR_VERSION,
      projectId: input.projectId,
      specSha256: generated.specSha256,
      planSha256: generated.planSha256,
      files: generated.files.map(({ path: filePath, bytes, sha256 }) => ({
        path: filePath,
        bytes,
        sha256,
      })),
    });

    if (input.mode === "dry-run") {
      return projectGenerationResultSchema.parse({ mode: "dry-run", plan });
    }

    const outputPath = await this.#apply(input.projectId, generated.files);
    return projectGenerationResultSchema.parse({ mode: "apply", plan, outputPath });
  }

  async #apply(projectId: string, files: ReadonlyArray<GeneratedFile>): Promise<string> {
    await mkdir(this.#outputRoot, { recursive: true });
    const rootInfo = await lstat(this.#outputRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new Error("Game project output root must be a real directory, not a symbolic link.");
    }
    const root = await realpath(this.#outputRoot);
    const target = safeChild(root, projectId);
    if (await exists(target)) {
      throw new Error(`Generated project already exists: ${projectId}`);
    }

    const temporary = safeChild(root, `.gameforge-tmp-${projectId}-${randomUUID()}`);
    await mkdir(temporary, { recursive: false });
    try {
      for (const file of files) {
        const destination = safeRelativeFile(temporary, file.path);
        await mkdir(path.dirname(destination), { recursive: true });
        const handle = await open(destination, "wx");
        try {
          await handle.writeFile(file.content, { encoding: "utf8" });
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      await rename(temporary, target);
      return target;
    } catch (error) {
      if (temporary.startsWith(`${root}${path.sep}`)) {
        await rm(temporary, { recursive: true, force: true });
      }
      throw error;
    }
  }
}

function createGeneratedFiles(projectId: string, spec: GameSpec): {
  files: ReadonlyArray<GeneratedFile>;
  specSha256: string;
  planSha256: string;
} {
  const specContent = `${JSON.stringify(spec, null, 2)}\n`;
  const baseFiles = [
    file(".npmrc", "registry=https://registry.npmjs.org/\n"),
    file("game-spec.json", specContent),
    file("index.html", createIndexHtml(spec.locale)),
    file("package.json", `${JSON.stringify({
      name: `gameforge-${projectId}`,
      version: "0.1.0",
      private: true,
      type: "module",
      packageManager: "bun@1.3.14",
      scripts: { dev: "vite", build: "tsc --noEmit && vite build", check: "tsc --noEmit" },
      dependencies: { phaser: "4.2.1" },
      devDependencies: { typescript: "7.0.2", vite: "8.1.4" },
    }, null, 2)}\n`),
    file("public/assets/manifest.json", `${JSON.stringify({
      schemaVersion: "1.0",
      projectId,
      revision: 0,
      assets: [],
    }, null, 2)}\n`),
    file("src/main.ts", runtimeSource),
    file("tsconfig.json", `${JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        esModuleInterop: true,
        lib: ["ES2023", "DOM", "DOM.Iterable"],
        types: ["vite/client"],
      },
      include: ["src", "vite.config.ts", "game-spec.json"],
    }, null, 2)}\n`),
    file("vite.config.ts", 'import { defineConfig } from "vite";\n\nexport default defineConfig({ base: "./" });\n'),
  ].sort((left, right) => left.path.localeCompare(right.path));

  const specSha256 = sha256(specContent);
  const planSha256 = sha256(JSON.stringify(baseFiles.map(({ path: filePath, bytes, sha256: hash }) => ({
    path: filePath,
    bytes,
    sha256: hash,
  }))));
  const manifest = file(".gameforge/manifest.json", `${JSON.stringify({
    schemaVersion: "1.0",
    generatorVersion: GENERATOR_VERSION,
    projectId,
    specSha256,
    planSha256,
    files: baseFiles.map(({ path: filePath, bytes, sha256: hash }) => ({
      path: filePath,
      bytes,
      sha256: hash,
    })),
  }, null, 2)}\n`);
  const files = [...baseFiles, manifest].sort((left, right) => left.path.localeCompare(right.path));
  const totalBytes = files.reduce((total, current) => total + current.bytes, 0);
  if (totalBytes > MAX_PROJECT_BYTES) {
    throw new Error("Generated project exceeds the maximum template size.");
  }
  return { files, specSha256, planSha256 };
}

function file(filePath: string, content: string): GeneratedFile {
  return {
    path: filePath,
    content,
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeChild(root: string, name: string): string {
  const candidate = path.resolve(root, name);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("Generated project path escaped the configured output root.");
  }
  return candidate;
}

function safeRelativeFile(root: string, filePath: string): string {
  if (path.isAbsolute(filePath) || filePath.includes("\0")) {
    throw new Error("Generated file path must be relative and normalized.");
  }
  const normalized = filePath.replaceAll("/", path.sep);
  if (normalized.split(path.sep).some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Generated file path contains an unsafe segment.");
  }
  return safeChild(root, normalized);
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
