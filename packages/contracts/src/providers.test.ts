import { describe, expect, it } from "vitest";
import {
  defaultProviderConfig,
  providerConfigSchema,
  validateProviderConfig,
} from "./providers.js";

describe("providerConfigSchema", () => {
  it("ships with a valid domestic-model-first default configuration", () => {
    const result = validateProviderConfig(defaultProviderConfig);

    expect(result.llm.coder).toEqual({
      provider: "bailian",
      model: "qwen3-coder-plus",
    });
    expect(result.image.provider).toBe("volcengine-ark");
    expect(result.tts.provider).toBe("volcengine-speech");
    expect(result.audioGeneration).toBeUndefined();
  });

  it("allows model IDs to be replaced without changing the schema", () => {
    const candidate = structuredClone(defaultProviderConfig);
    candidate.llm.coder.model = "organization/custom-coder:v2";

    expect(validateProviderConfig(candidate).llm.coder.model).toBe(
      "organization/custom-coder:v2",
    );
  });

  it("rejects secret values and other undeclared fields", () => {
    const result = providerConfigSchema.safeParse({
      ...defaultProviderConfig,
      apiKey: "must-not-be-stored-here",
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed provider and model identifiers", () => {
    const candidate = structuredClone(defaultProviderConfig);
    candidate.image.provider = "Volcengine Ark";
    candidate.image.model = "../../model";

    expect(providerConfigSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects undeclared providers and capability mismatches", () => {
    const undeclared = structuredClone(defaultProviderConfig);
    undeclared.llm.coder.provider = "missing-provider";

    const wrongCapability = structuredClone(defaultProviderConfig);
    wrongCapability.image.provider = "bailian";

    expect(providerConfigSchema.safeParse(undeclared).success).toBe(false);
    expect(providerConfigSchema.safeParse(wrongCapability).success).toBe(false);
  });
});
