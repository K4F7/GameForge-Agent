import { z } from "zod";

export const douyinPlatformCapabilityNames = [
  "network",
  "login",
  "share",
  "ads",
  "payments",
] as const;

export const douyinPlatformPolicySchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  target: z.literal("douyin-mini-game"),
  adapter: z.strictObject({
    engine: z.literal("layaair"),
    version: z.literal("3.4.0"),
  }),
  capabilities: z.strictObject(Object.fromEntries(
    douyinPlatformCapabilityNames.map((name) => [name, z.boolean()]),
  ) as Record<(typeof douyinPlatformCapabilityNames)[number], z.ZodBoolean>),
  allowedNetworkHosts: z.array(
    z.string().min(1).max(253).regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  ).max(100).refine((hosts) => new Set(hosts).size === hosts.length, "Network hosts must be unique."),
  remoteScripts: z.literal(false),
});

export type DouyinPlatformPolicy = z.infer<typeof douyinPlatformPolicySchema>;
