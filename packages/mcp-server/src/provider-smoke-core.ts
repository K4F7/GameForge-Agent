export const providerNames = ["qwen", "seedream", "freesound", "tts"] as const;
export type ProviderName = typeof providerNames[number];

const requirements: Record<ProviderName, readonly string[]> = {
  qwen: ["DASHSCOPE_API_KEY"],
  seedream: ["VOLCENGINE_ARK_API_KEY", "GAMEFORGE_IMAGE_MODEL", "GAMEFORGE_IMAGE_LICENSE"],
  freesound: ["FREESOUND_API_KEY", "FREESOUND_API_USAGE"],
  tts: [
    "VOLCENGINE_SPEECH_API_TOKEN",
    "VOLCENGINE_SPEECH_APP_ID",
    "GAMEFORGE_TTS_LICENSE",
    "GAMEFORGE_TTS_AUDIO_HOSTS",
    "GAMEFORGE_TTS_SMOKE_VOICE",
  ],
};

export function parseProviderSelection(value: string | undefined): ProviderName[] {
  if (value === undefined || value === "all") return [...providerNames];
  const selected = value.split(",").map((item) => item.trim()).filter(Boolean);
  const invalid = selected.filter((item) => !providerNames.includes(item as ProviderName));
  if (invalid.length > 0 || selected.length === 0) throw new Error(`Unsupported provider selection: ${value}`);
  return [...new Set(selected as ProviderName[])];
}

export function missingProviderEnvironment(provider: ProviderName, env: NodeJS.ProcessEnv): string[] {
  return requirements[provider].filter((name) => env[name]?.trim().length === 0 || env[name] === undefined);
}

export function publicEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicEvidence);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
      if (/key|token|secret|authorization|jobHandle|audioUrl|previewUrl|sourceUrl/i.test(key)) return [];
      return [[key, publicEvidence(child)]];
    }));
  }
  return value;
}
