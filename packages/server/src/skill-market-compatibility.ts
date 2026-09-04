import { parse } from "yaml";

const OPENCLAW_METADATA_KEYS = ["openclaw", "clawdbot", "clawdis"] as const;
const RUNTIME_KEYS = ["primaryEnv", "envVars", "install", "nix", "config", "skillKey"];
const REQUIREMENT_KEYS = ["env", "bins", "anyBins", "config"];

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function frontmatter(source: string): string | undefined {
  const normalized = source.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(normalized);
  return match?.[1];
}

function hasRuntimeDependency(metadata: Record<string, unknown>): boolean {
  if (metadata["always"] === true || RUNTIME_KEYS.some((key) => nonEmpty(metadata[key]))) {
    return true;
  }
  const requires = record(metadata["requires"]);
  return requires !== undefined && REQUIREMENT_KEYS.some((key) => nonEmpty(requires[key]));
}

export function isCodexCompatibleSkill(source: string): boolean {
  const content = frontmatter(source);
  if (content === undefined) return false;
  let document: Record<string, unknown> | undefined;
  try {
    document = record(parse(content));
  } catch {
    return false;
  }
  if (
    document === undefined ||
    typeof document["name"] !== "string" ||
    document["name"].trim().length === 0 ||
    typeof document["description"] !== "string" ||
    document["description"].trim().length === 0
  ) {
    return false;
  }
  const metadata = record(document["metadata"]);
  return !OPENCLAW_METADATA_KEYS.some((key) => {
    const runtime = record(metadata?.[key]);
    return runtime !== undefined && hasRuntimeDependency(runtime);
  });
}
