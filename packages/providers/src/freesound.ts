import type { SoundSearchProvider } from "@gameforge/contracts";
import { z } from "zod";

const DEFAULT_ENDPOINT = "https://freesound.org/apiv2/search/";
const TRUSTED_ENDPOINT_HOST = "freesound.org";
const SEARCH_FIELDS = [
  "id",
  "name",
  "username",
  "license",
  "url",
  "previews",
  "description",
  "tags",
  "duration",
  "type",
].join(",");

const httpsUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      (url.port === "" || url.port === "443")
    );
  }, "URL must use HTTPS without credentials or a custom port.");

export const freesoundLicensePolicySchema = z.enum(["cc0", "cc-by", "cc0-or-cc-by"]);
export const freesoundSortSchema = z.enum([
  "score",
  "duration_desc",
  "duration_asc",
  "created_desc",
  "created_asc",
  "downloads_desc",
  "downloads_asc",
  "rating_desc",
  "rating_asc",
]);

export const freesoundSearchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(300),
  license: freesoundLicensePolicySchema.default("cc0"),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(150).default(15),
  sort: freesoundSortSchema.default("score"),
});

const freesoundApiLicenseSchema = z.enum([
  "Creative Commons 0",
  "Attribution",
  "Attribution NonCommercial",
]);

const soundSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1),
  username: z.string().trim().min(1),
  license: freesoundApiLicenseSchema,
  url: httpsUrlSchema,
  previews: z.object({
    "preview-hq-mp3": httpsUrlSchema.optional(),
    "preview-lq-mp3": httpsUrlSchema.optional(),
    "preview-hq-ogg": httpsUrlSchema.optional(),
    "preview-lq-ogg": httpsUrlSchema.optional(),
  }),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  duration: z.number().nonnegative(),
  type: z.string().trim().min(1),
});

const searchResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  results: z.array(soundSchema),
});

export type FreesoundSearchRequest = z.input<typeof freesoundSearchRequestSchema>;

export type FreesoundSearchResult = {
  total: number;
  candidates: ReadonlyArray<{
    soundId: number;
    name: string;
    username: string;
    license: "Creative Commons 0" | "Attribution";
    sourceUrl: string;
    previewUrl: string;
    attribution: string;
    description: string;
    tags: ReadonlyArray<string>;
    durationSeconds: number;
    fileType: string;
  }>;
};

export type FreesoundFetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type FreesoundProviderOptions = {
  apiKey: string;
  apiUsage: "non-commercial" | "commercial-agreement";
  endpoint?: string;
  fetch?: FreesoundFetchLike;
};

export class FreesoundProvider
  implements SoundSearchProvider<FreesoundSearchRequest, FreesoundSearchResult>
{
  readonly id = "freesound";
  readonly capability = "sound-search" as const;

  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: FreesoundFetchLike;

  constructor(options: FreesoundProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey.length === 0) {
      throw new Error("Freesound API key is required at runtime.");
    }
    if (options.apiUsage !== "non-commercial" && options.apiUsage !== "commercial-agreement") {
      throw new Error(
        "Freesound API usage must be declared as non-commercial or covered by a commercial agreement.",
      );
    }

    const endpoint = new URL(httpsUrlSchema.parse(options.endpoint ?? DEFAULT_ENDPOINT));
    if (
      endpoint.hostname !== TRUSTED_ENDPOINT_HOST ||
      endpoint.pathname !== "/apiv2/search/" ||
      endpoint.search !== "" ||
      endpoint.hash !== ""
    ) {
      throw new Error(`Freesound endpoint must use the official ${TRUSTED_ENDPOINT_HOST} search API.`);
    }

    this.#apiKey = apiKey;
    this.#endpoint = endpoint.href;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async execute(request: FreesoundSearchRequest): Promise<FreesoundSearchResult> {
    const input = freesoundSearchRequestSchema.parse(request);
    const url = new URL(this.#endpoint);
    url.searchParams.set("query", input.query);
    url.searchParams.set("filter", licenseFilter(input.license));
    url.searchParams.set("fields", SEARCH_FIELDS);
    url.searchParams.set("sort", input.sort);
    url.searchParams.set("page", String(input.page));
    url.searchParams.set("page_size", String(input.pageSize));

    const response = await this.#fetch(url, {
      method: "GET",
      headers: { Authorization: `Token ${this.#apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`Freesound search failed with HTTP ${response.status}.`);
    }

    const parsed = searchResponseSchema.parse(await response.json());
    const candidates = parsed.results.flatMap((sound) => {
      if (!isAllowedLicense(input.license, sound.license)) {
        throw new Error("Freesound response contained a sound outside the requested license policy.");
      }

      const previewUrl =
        sound.previews["preview-hq-mp3"] ??
        sound.previews["preview-lq-mp3"] ??
        sound.previews["preview-hq-ogg"] ??
        sound.previews["preview-lq-ogg"];
      if (previewUrl === undefined) {
        return [];
      }

      return [{
        soundId: sound.id,
        name: sound.name,
        username: sound.username,
        license: sound.license,
        sourceUrl: sound.url,
        previewUrl,
        attribution: `“${sound.name}” — ${sound.username} — ${sound.license} — ${sound.url}`,
        description: sound.description,
        tags: sound.tags,
        durationSeconds: sound.duration,
        fileType: sound.type,
      }];
    });

    return { total: parsed.count, candidates };
  }
}

function licenseFilter(policy: z.infer<typeof freesoundLicensePolicySchema>): string {
  switch (policy) {
    case "cc0":
      return 'license:"Creative Commons 0"';
    case "cc-by":
      return "license:Attribution";
    case "cc0-or-cc-by":
      return 'license:("Creative Commons 0" OR Attribution)';
  }
}

function isAllowedLicense(
  policy: z.infer<typeof freesoundLicensePolicySchema>,
  license: z.infer<typeof freesoundApiLicenseSchema>,
): license is "Creative Commons 0" | "Attribution" {
  if (license === "Attribution NonCommercial") {
    return false;
  }
  return policy === "cc0-or-cc-by" ||
    (policy === "cc0" && license === "Creative Commons 0") ||
    (policy === "cc-by" && license === "Attribution");
}
