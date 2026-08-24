import { Buffer } from "node:buffer";

import {
  AgentProviderConnectionRecordSchema,
  type AgentProviderConnectionRecord,
} from "@codexly/protocol";
import { Value } from "@sinclair/typebox/value";

const MAX_PROVIDER_MODELS = 1_000;
const MAX_PROVIDER_MODELS_JSON_BYTES = 1024 * 1024;

export const PROVIDER_CONNECTION_MIGRATION = {
  name: "create_provider_connection",
  sql: `
    CREATE TABLE provider_connection (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL CHECK (mode IN ('official', 'custom')),
      custom_base_url TEXT,
      custom_models_json TEXT,
      updated_at TEXT NOT NULL,
      CHECK (
        (mode = 'official' AND custom_base_url IS NULL AND custom_models_json IS NULL)
        OR
        (mode = 'custom' AND custom_base_url IS NOT NULL AND custom_models_json IS NOT NULL)
      )
    ) STRICT;
  `,
  version: 11,
} as const;

export type ProviderConnectionRow = Readonly<{
  customBaseUrl: unknown;
  customModelsJson: unknown;
  mode: unknown;
  updatedAt: unknown;
}>;

export function parseProviderConnectionRow(
  row: ProviderConnectionRow | undefined,
): AgentProviderConnectionRecord | undefined {
  if (row === undefined) {
    return undefined;
  }
  if (
    row.customModelsJson !== null &&
    (typeof row.customModelsJson !== "string" ||
      Buffer.byteLength(row.customModelsJson, "utf8") > MAX_PROVIDER_MODELS_JSON_BYTES)
  ) {
    throw new Error("Stored provider model JSON exceeds the supported size");
  }

  let customModels: unknown = null;
  if (typeof row.customModelsJson === "string") {
    try {
      customModels = JSON.parse(row.customModelsJson) as unknown;
    } catch {
      throw new Error("Stored provider model JSON is invalid");
    }
  }
  const record = {
    customBaseUrl: row.customBaseUrl,
    customModels,
    mode: row.mode,
    updatedAt: row.updatedAt,
  };
  if (!Value.Check(AgentProviderConnectionRecordSchema, record)) {
    throw new Error("Stored provider connection record is invalid");
  }
  if (record.customModels !== null && record.customModels.data.length > MAX_PROVIDER_MODELS) {
    throw new Error("Stored provider connection record is invalid");
  }
  return record;
}

export function serializeProviderConnectionRecord(
  record: AgentProviderConnectionRecord,
): string | null {
  if (!Value.Check(AgentProviderConnectionRecordSchema, record)) {
    throw new Error("Provider connection record is invalid");
  }
  if (record.customModels === null) {
    return null;
  }
  const customModelsJson = JSON.stringify(record.customModels);
  if (
    record.customModels.data.length > MAX_PROVIDER_MODELS ||
    Buffer.byteLength(customModelsJson, "utf8") > MAX_PROVIDER_MODELS_JSON_BYTES
  ) {
    throw new Error("Provider model JSON exceeds the supported limits");
  }
  return customModelsJson;
}
