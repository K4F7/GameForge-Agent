import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadModelRoutingPolicy } from "./model-routing.js";

describe("model routing policy loader", () => {
  it("loads the committed secret-free policy through the shared contract", async () => {
    const file = path.resolve(import.meta.dirname, "../../../config/model-routing.example.json");
    const policy = await loadModelRoutingPolicy(file);
    expect(policy.agent.coding.owner).toBe("codearts");
    expect(policy.tools.image.primary.provider).toBe("volcengine-ark");
  });

  it("rejects relative and invalid policy files", async () => {
    await expect(loadModelRoutingPolicy("config/model-routing.example.json")).rejects.toThrow("absolute");
    const directory = await mkdtemp(path.join(os.tmpdir(), "gameforge-routing-"));
    const file = path.join(directory, "policy.json");
    await writeFile(file, "{}", "utf8");
    await expect(loadModelRoutingPolicy(file)).rejects.toThrow();
  });
});
