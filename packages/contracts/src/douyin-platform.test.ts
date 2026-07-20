import { describe, expect, it } from "vitest";
import { douyinPlatformPolicySchema } from "./douyin-platform.js";

describe("douyinPlatformPolicySchema", () => {
  it("accepts an offline LayaAir policy and rejects unsafe host declarations", () => {
    const policy = {
      schemaVersion: "1.0",
      target: "douyin-mini-game",
      adapter: { engine: "layaair", version: "3.4.0" },
      capabilities: { network: false, login: false, share: false, ads: false, payments: false },
      allowedNetworkHosts: [],
      remoteScripts: false,
    } as const;
    expect(douyinPlatformPolicySchema.parse(policy)).toEqual(policy);
    expect(douyinPlatformPolicySchema.safeParse({ ...policy, allowedNetworkHosts: ["localhost"] }).success).toBe(false);
    expect(douyinPlatformPolicySchema.safeParse({ ...policy, allowedNetworkHosts: ["api.example.com", "api.example.com"] }).success).toBe(false);
  });
});
