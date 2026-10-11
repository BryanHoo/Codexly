import { readCodexFileTextInput } from "./codex-file-input.js";
import { optionalString } from "./codex-protocol-mapping.js";
import type {
  HistoricalAttachmentStore,
  HistoricalAttachmentResult,
} from "./persistent-historical-attachment-store.js";
import { readStagedImage, stagedImageName } from "./jsonl-frame-processor.js";

export function mapCodexMessageImage(
  store: HistoricalAttachmentStore,
  taskId: string,
  part: Record<string, unknown>,
  imageIndex: number,
): HistoricalAttachmentResult {
  const staged = readStagedImage(part);
  if (staged !== undefined) {
    const name = optionalString(part["name"]) ?? stagedImageName(part, imageIndex);
    return store.addStagedImage(taskId, staged, imageIndex, name);
  }
  if (part["type"] === "imageGeneration") {
    const savedPath = optionalString(part["savedPath"]);
    if (savedPath !== undefined) {
      const savedAttachment = store.addLocalImage(taskId, savedPath, imageIndex);
      if (savedAttachment instanceof Promise) {
        return savedAttachment.then((attachment) => {
          if (attachment !== undefined) return attachment;
          const encoded = optionalString(part["result"]);
          return encoded === undefined
            ? undefined
            : store.addBase64Image(taskId, { encoded }, imageIndex);
        });
      }
      if (savedAttachment !== undefined) return savedAttachment;
    }
    const encoded = optionalString(part["result"]);
    return encoded === undefined
      ? undefined
      : store.addBase64Image(taskId, { encoded }, imageIndex);
  }
  if (part["type"] === "image") {
    const url = optionalString(part["url"]);
    if (url === undefined) {
      // 0.156 可返回仅含 fileId 的远程图片；App Server 未提供读取接口时只显示图片占位符。
      return undefined;
    }
    const name = optionalString(part["name"]);
    return store.addDataUrl(taskId, { ...(name === undefined ? {} : { name }), url }, imageIndex);
  }
  const path = optionalString(part["path"]);
  return path === undefined ? undefined : store.addLocalImage(taskId, path, imageIndex);
}

export function mapCodexMessageText(
  store: HistoricalAttachmentStore,
  taskId: string,
  input: Readonly<{ name: string; text: string }>,
  textIndex: number,
): HistoricalAttachmentResult {
  const file = readCodexFileTextInput(input);
  return file === undefined
    ? store.addText(taskId, input, textIndex)
    : store.addLocalFile(taskId, file);
}
