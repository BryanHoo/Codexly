import { Buffer } from "node:buffer";

import type { AgentProviderTurnInput } from "@codexly/core";

const FILE_PLACEHOLDER_PREFIX = "codexly-file:";
type ProviderFileInput = AgentProviderTurnInput["files"][number];

export function createCodexFileTextInput(file: ProviderFileInput) {
  const placeholder = `${FILE_PLACEHOLDER_PREFIX}${Buffer.from(
    JSON.stringify({ mediaType: file.mediaType, name: file.name }),
    "utf8",
  ).toString("base64url")}`;
  return {
    text: file.path,
    text_elements: [
      {
        byteRange: { end: Buffer.byteLength(file.path, "utf8"), start: 0 },
        placeholder,
      },
    ],
    type: "text" as const,
  };
}

export function readCodexFileTextInput(
  input: Readonly<{ name: string; text: string }>,
): ProviderFileInput | undefined {
  if (!input.name.startsWith(FILE_PLACEHOLDER_PREFIX)) {
    return undefined;
  }
  try {
    const encoded = input.name.slice(FILE_PLACEHOLDER_PREFIX.length);
    const metadata = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      !("mediaType" in metadata) ||
      !("name" in metadata) ||
      typeof metadata.mediaType !== "string" ||
      metadata.mediaType.length === 0 ||
      metadata.mediaType.length > 255 ||
      typeof metadata.name !== "string" ||
      metadata.name.length === 0 ||
      metadata.name.length > 255
    ) {
      return undefined;
    }
    return { mediaType: metadata.mediaType, name: metadata.name, path: input.text };
  } catch {
    return undefined;
  }
}
