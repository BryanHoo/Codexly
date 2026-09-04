import type { ClawhubSkillDetail, ClawhubSkillPage } from "@codexly/protocol";

import {
  buildClawhubCatalogUrl,
  parseClawhubCatalogPage,
  parseClawhubSkillDetail,
} from "./skill-market-catalog.js";
import { isCodexCompatibleSkill } from "./skill-market-compatibility.js";
import { SkillMarketError } from "./skill-market-error.js";
import type { DownloadedSkillArchive } from "./skill-market-installer.js";

const CLAWHUB_ORIGIN = "https://clawhub.ai";
const JSON_LIMIT = 512 * 1024;
const SKILL_MD_LIMIT = 256 * 1024;
const ARCHIVE_LIMIT = 50 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 18_000;
const MAX_REDIRECTS = 3;

export interface ClawhubClient {
  downloadArchive(owner: string, slug: string, version: string): Promise<DownloadedSkillArchive>;
  getSkill(owner: string, slug: string): Promise<ClawhubSkillDetail>;
  listSkills(query: string, cursor: string | null, sort: string): Promise<ClawhubSkillPage>;
}

type CreateClawhubClientOptions = Readonly<{
  fetch?: typeof globalThis.fetch;
}>;

function requestError(status: number): SkillMarketError {
  if (status === 429) {
    return new SkillMarketError("SKILL_MARKET_RATE_LIMITED", "ClawHub rate limit reached");
  }
  if (status === 404) {
    return new SkillMarketError("SKILL_MARKET_NOT_FOUND", "Skill package was not found");
  }
  return new SkillMarketError("SKILL_MARKET_NETWORK", "ClawHub request failed");
}

async function request(
  fetchImplementation: typeof globalThis.fetch,
  initialUrl: URL,
): Promise<Response> {
  let url = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetchImplementation(url, {
        headers: { "user-agent": "Codexly Skills-Market" },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new SkillMarketError("SKILL_MARKET_NETWORK", "ClawHub request failed");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null || redirectCount === MAX_REDIRECTS) throw requestError(response.status);
      url = new URL(location, url);
      if (url.protocol !== "https:") throw requestError(response.status);
      continue;
    }
    if (!response.ok) throw requestError(response.status);
    return response;
  }
  throw new SkillMarketError("SKILL_MARKET_NETWORK", "ClawHub redirected too many times");
}

async function responseBytes(response: Response, limit: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new SkillMarketError("SKILL_MARKET_INVALID_RESPONSE", "ClawHub response is too large");
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const result = (await reader.read()) as Readonly<{
      done: boolean;
      value?: Uint8Array;
    }>;
    if (result.done) break;
    const value = result.value;
    if (value === undefined) {
      throw new SkillMarketError("SKILL_MARKET_INVALID_RESPONSE", "ClawHub response is invalid");
    }
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new SkillMarketError("SKILL_MARKET_INVALID_RESPONSE", "ClawHub response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function getJson(fetchImplementation: typeof globalThis.fetch, url: URL): Promise<unknown> {
  try {
    return JSON.parse(
      new TextDecoder().decode(
        await responseBytes(await request(fetchImplementation, url), JSON_LIMIT),
      ),
    ) as unknown;
  } catch (error) {
    if (error instanceof SkillMarketError) throw error;
    throw new SkillMarketError("SKILL_MARKET_INVALID_RESPONSE", "ClawHub JSON is invalid");
  }
}

function skillUrl(path: string, owner: string, slug: string): URL {
  const valid = [owner, slug].every(
    (value) => value.length > 0 && value.length <= 100 && /^[A-Za-z0-9_-]+$/.test(value),
  );
  if (!valid) {
    throw new SkillMarketError("SKILL_MARKET_INVALID_RESPONSE", "Skill identity is invalid");
  }
  const url = new URL(path, CLAWHUB_ORIGIN);
  url.searchParams.set("ownerHandle", owner);
  return url;
}

async function skillMarkdown(
  fetchImplementation: typeof globalThis.fetch,
  owner: string,
  slug: string,
): Promise<string> {
  const url = skillUrl(`/api/v1/skills/${slug}/file`, owner, slug);
  url.searchParams.set("path", "SKILL.md");
  url.searchParams.set("tag", "latest");
  url.searchParams.set("preview", "1");
  const text = new TextDecoder().decode(
    await responseBytes(await request(fetchImplementation, url), SKILL_MD_LIMIT),
  );
  try {
    const payload = JSON.parse(text) as unknown;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload))
      throw new Error();
    const root = payload as Record<string, unknown>;
    const direct = root["content"];
    const file = root["file"];
    const nested =
      typeof file === "object" && file !== null && !Array.isArray(file)
        ? (file as Record<string, unknown>)["content"]
        : undefined;
    if (typeof direct === "string") return direct;
    if (typeof nested === "string") return nested;
    throw new Error();
  } catch {
    if (text.trimStart().startsWith("---")) return text;
    throw new SkillMarketError("SKILL_MARKET_INVALID_RESPONSE", "Skill content is invalid");
  }
}

export function createClawhubClient(options: CreateClawhubClientOptions = {}): ClawhubClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  return {
    async listSkills(query, cursor, sort) {
      const url = buildClawhubCatalogUrl(query, cursor, sort);
      return parseClawhubCatalogPage(
        await getJson(fetchImplementation, url),
        query.trim().length > 0,
      );
    },
    async getSkill(owner, slug) {
      const [detail, versions, scan, readme] = await Promise.all([
        getJson(fetchImplementation, skillUrl(`/api/v1/skills/${slug}`, owner, slug)),
        getJson(fetchImplementation, skillUrl(`/api/v1/skills/${slug}/versions`, owner, slug)),
        getJson(fetchImplementation, skillUrl(`/api/v1/skills/${slug}/scan`, owner, slug)),
        skillMarkdown(fetchImplementation, owner, slug),
      ]);
      if (!isCodexCompatibleSkill(readme)) {
        throw new SkillMarketError(
          "SKILL_MARKET_INCOMPATIBLE",
          "Skill is not compatible with Codex",
        );
      }
      return parseClawhubSkillDetail(detail, versions, scan, readme);
    },
    async downloadArchive(owner, slug, version) {
      const url = skillUrl("/api/v1/download", owner, slug);
      url.searchParams.set("slug", slug);
      url.searchParams.set("version", version);
      const response = await request(fetchImplementation, url);
      const bytes = await responseBytes(response, ARCHIVE_LIMIT);
      if (!response.headers.get("content-type")?.includes("json")) {
        return { bytes, contentHash: null, sourcePath: null };
      }
      let handoff: Record<string, unknown>;
      try {
        const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
        handoff = value as Record<string, unknown>;
      } catch {
        throw new SkillMarketError("SKILL_MARKET_INVALID_ARCHIVE", "Archive handoff is invalid");
      }
      const archiveUrl =
        typeof handoff["archiveUrl"] === "string" ? new URL(handoff["archiveUrl"]) : undefined;
      const contentHash = handoff["contentHash"];
      const sourcePath = handoff["path"];
      if (
        handoff["sourceRef"] !== "public-github" ||
        archiveUrl?.protocol !== "https:" ||
        (archiveUrl.hostname !== "github.com" && archiveUrl.hostname !== "codeload.github.com") ||
        typeof sourcePath !== "string" ||
        sourcePath.length === 0 ||
        sourcePath.length > 512 ||
        typeof contentHash !== "string" ||
        !/^[A-Fa-f0-9]{64}$/.test(contentHash)
      ) {
        throw new SkillMarketError("SKILL_MARKET_INVALID_ARCHIVE", "Archive handoff is invalid");
      }
      return {
        bytes: await responseBytes(await request(fetchImplementation, archiveUrl), ARCHIVE_LIMIT),
        contentHash: contentHash.toLowerCase(),
        sourcePath,
      };
    },
  };
}
