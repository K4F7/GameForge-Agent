import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { modelRoutingPolicySchema, type ModelRoutingPolicy } from "@gameforge/contracts";

const MAX_POLICY_BYTES = 256 * 1024;

export async function loadModelRoutingPolicy(filePath: string): Promise<ModelRoutingPolicy> {
  if (!path.isAbsolute(filePath)) throw new Error("Model routing policy path must be absolute.");
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size > MAX_POLICY_BYTES) {
    throw new Error("Model routing policy must be a regular JSON file no larger than 256 KiB.");
  }
  const text = await readFile(filePath, "utf8");
  return modelRoutingPolicySchema.parse(JSON.parse(text) as unknown);
}
