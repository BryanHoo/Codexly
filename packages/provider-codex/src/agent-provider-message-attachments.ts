import type { AgentMessageAttachment } from "@codexly/protocol";

import { readCodexFileTextInput } from "./codex-file-input.js";
import { optionalString } from "./codex-protocol-mapping.js";
import type { CodexHistoricalAttachmentStore } from "./historical-attachment-store.js";
import { readStagedImage, stagedImageName } from "./jsonl-frame-processor.js";

export function mapCodexMessageImage(
  store: CodexHistoricalAttachmentStore,
  taskId: string,
  part: Record<string, unknown>,
  imageIndex: number,
): AgentMessageAttachment | undefined {
  const staged = readStagedImage(part);
  if (staged !== undefined) {
    const name = optionalString(part["name"]) ?? stagedImageName(part, imageIndex);
    return store.addStagedImage(taskId, staged, imageIndex, name);
  }
  if (part["type"] === "imageGeneration") {
    const savedPath = optionalString(part["savedPath"]);
    if (savedPath !== undefined) {
      const savedAttachment = store.addLocalImage(taskId, savedPath, imageIndex);
      if (savedAttachment !== undefined) {
        return savedAttachment;
      }
    }
    const encoded = optionalString(part["result"]);
    return encoded === undefined
      ? undefined
      : store.addBase64Image(taskId, { encoded }, imageIndex);
  }
  if (part["type"] === "image") {
    const url = optionalString(part["url"]);
    if (url === undefined) {
      return undefined;
    }
    const name = optionalString(part["name"]);
    return store.addDataUrl(taskId, { ...(name === undefined ? {} : { name }), url }, imageIndex);
  }
  const path = optionalString(part["path"]);
  return path === undefined ? undefined : store.addLocalImage(taskId, path, imageIndex);
}

export function mapCodexMessageText(
  store: CodexHistoricalAttachmentStore,
  taskId: string,
  input: Readonly<{ name: string; text: string }>,
  textIndex: number,
): AgentMessageAttachment | undefined {
  const file = readCodexFileTextInput(input);
  return file === undefined
    ? store.addText(taskId, input, textIndex)
    : store.addLocalFile(taskId, file);
}
