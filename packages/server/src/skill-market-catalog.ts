import type { ClawhubSkillDetail, ClawhubSkillPage, ClawhubSkillSummary } from "@codexly/protocol";

import { SkillMarketError } from "./skill-market-error.js";

const CLAWHUB_ORIGIN = "https://clawhub.ai";
const CATALOG_PAGE_SIZE = "24";

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SkillMarketError("SKILL_MARKET_INVALID_RESPONSE", `${context} is invalid`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

function mapSummary(value: unknown): ClawhubSkillSummary | undefined {
  const item = record(value, "ClawHub package");
  if (item["family"] !== undefined && item["family"] !== "skill") return undefined;
  const slug = nonEmptyString(item["name"] ?? item["slug"]);
  const owner = nonEmptyString(item["ownerHandle"]);
  const latestVersion = nonEmptyString(item["latestVersion"]);
  if (slug === undefined || owner === undefined || latestVersion === undefined) return undefined;
  const stats = record(item["stats"] ?? {}, "ClawHub package stats");
  const topics = Array.isArray(item["topics"])
    ? item["topics"].filter((topic): topic is string => typeof topic === "string").slice(0, 8)
    : [];
  return {
    canonicalUrl: `${CLAWHUB_ORIGIN}/${owner}/skills/${slug}`,
    displayName: nonEmptyString(item["displayName"]) ?? slug,
    downloads: integer(stats["downloads"]),
    id: `${owner}/${slug}`,
    latestVersion,
    owner,
    slug,
    stars: integer(stats["stars"]),
    summary: typeof item["summary"] === "string" ? item["summary"] : "",
    topics,
    updatedAt: integer(item["updatedAt"]),
    versionCount: integer(stats["versions"]),
  };
}

export function buildClawhubCatalogUrl(query: string, cursor: string | null, sort: string): URL {
  const normalizedQuery = query.trim();
  const url = new URL(
    normalizedQuery.length === 0 ? "/api/v1/packages" : "/api/v1/packages/search",
    CLAWHUB_ORIGIN,
  );
  url.searchParams.set("family", "skill");
  url.searchParams.set("limit", CATALOG_PAGE_SIZE);
  if (normalizedQuery.length === 0) {
    url.searchParams.set("sort", sort === "downloads" || sort === "updated" ? sort : "recommended");
    if (cursor !== null && cursor.length > 0) url.searchParams.set("cursor", cursor);
  } else {
    url.searchParams.set("q", normalizedQuery.slice(0, 120));
  }
  return url;
}

export function parseClawhubCatalogPage(payload: unknown, search: boolean): ClawhubSkillPage {
  const root = record(payload, "ClawHub catalog");
  const rawValues = root[search ? "results" : "items"];
  if (!Array.isArray(rawValues)) {
    throw new SkillMarketError(
      "SKILL_MARKET_INVALID_RESPONSE",
      "ClawHub catalog items are invalid",
    );
  }
  const values: unknown[] = rawValues;
  const items = values.flatMap((value) => {
    const candidate: unknown = search ? record(value, "ClawHub search result")["package"] : value;
    const mapped = mapSummary(candidate);
    return mapped === undefined ? [] : [mapped];
  });
  return {
    items,
    nextCursor: search ? null : (nonEmptyString(root["nextCursor"]) ?? null),
  };
}

export function parseClawhubSkillDetail(
  detailPayload: unknown,
  versionsPayload: unknown,
  scanPayload: unknown,
  readme: string,
): ClawhubSkillDetail {
  const detail = record(detailPayload, "ClawHub skill detail");
  const skill = record(detail["skill"], "ClawHub skill");
  const latest = record(detail["latestVersion"], "ClawHub latest version");
  const owner = nonEmptyString(record(detail["owner"], "ClawHub owner")["handle"]);
  const slug = nonEmptyString(skill["slug"]);
  const latestVersion = nonEmptyString(latest["version"]);
  if (owner === undefined || slug === undefined || latestVersion === undefined) {
    throw new SkillMarketError(
      "SKILL_MARKET_INVALID_RESPONSE",
      "ClawHub skill identity is invalid",
    );
  }
  const summary = mapSummary({
    ...skill,
    family: "skill",
    latestVersion,
    name: slug,
    ownerHandle: owner,
  });
  if (summary === undefined) {
    throw new SkillMarketError("SKILL_MARKET_INVALID_RESPONSE", "ClawHub skill summary is invalid");
  }
  const rawVersions = record(versionsPayload, "ClawHub versions")["items"];
  if (!Array.isArray(rawVersions)) {
    throw new SkillMarketError("SKILL_MARKET_INVALID_RESPONSE", "ClawHub versions are invalid");
  }
  const security = record(
    record(scanPayload, "ClawHub scan")["security"] ?? {},
    "ClawHub security",
  );
  return {
    ...summary,
    changelog: typeof latest["changelog"] === "string" ? latest["changelog"] : "",
    hasWarnings: security["hasWarnings"] === true,
    readme,
    scanStatus: nonEmptyString(security["status"]) ?? "not-run",
    versions: rawVersions
      .flatMap((value) => {
        const version = record(value, "ClawHub version");
        const name = nonEmptyString(version["version"]);
        return name === undefined
          ? []
          : [
              {
                changelog: typeof version["changelog"] === "string" ? version["changelog"] : "",
                createdAt: integer(version["createdAt"]),
                version: name,
              },
            ];
      })
      .slice(0, 20),
  };
}
