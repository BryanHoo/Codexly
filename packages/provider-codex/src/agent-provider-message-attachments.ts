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
  signal?: AbortSignal,
): HistoricalAttachmentResult {
  const staged = readStagedImage(part);
  if (staged !== undefined) {
    const name = optionalString(part["name"]) ?? stagedImageName(part, imageIndex);
    return store.addStagedImage(taskId, staged, imageIndex, name, signal);
  }
  if (part["type"] === "imageGeneration") {
    // fileId 是上游附件身份，不是本地路径；只允许使用其 savedPath，不回退旧正文。
    if ((optionalString(part["fileId"])?.length ?? 0) > 0) {
      const savedPath = optionalString(part["savedPath"]);
      return savedPath === undefined
        ? undefined
        : store.addLocalImage(taskId, savedPath, imageIndex, signal);
    }
    const savedPath = optionalString(part["savedPath"]);
    if (savedPath !== undefined) {
      const savedAttachment = store.addLocalImage(taskId, savedPath, imageIndex, signal);
      if (savedAttachment instanceof Promise) {
        return savedAttachment.then((attachment) => {
          if (signal?.aborted || attachment !== undefined) return attachment;
          const encoded = optionalString(part["result"]);
          return encoded === undefined
            ? undefined
            : store.addBase64Image(taskId, { encoded }, imageIndex, signal);
        });
      }
      if (savedAttachment !== undefined) return savedAttachment;
    }
    const encoded = optionalString(part["result"]);
    return encoded === undefined
      ? undefined
      : store.addBase64Image(taskId, { encoded }, imageIndex, signal);
  }
  if (part["type"] === "image") {
    const url = optionalString(part["url"]);
    if (url === undefined) {
      // 0.156 可返回仅含 fileId 的远程图片；App Server 未提供读取接口时只显示图片占位符。
      return undefined;
    }
    const name = optionalString(part["name"]);
    return store.addDataUrl(
      taskId,
      { ...(name === undefined ? {} : { name }), url },
      imageIndex,
      signal,
    );
  }
  const path = optionalString(part["path"]);
  return path === undefined ? undefined : store.addLocalImage(taskId, path, imageIndex, signal);
}

export function mapCodexMessageText(
  store: HistoricalAttachmentStore,
  taskId: string,
  input: Readonly<{ name: string; text: string }>,
  textIndex: number,
  signal?: AbortSignal,
): HistoricalAttachmentResult {
  const file = readCodexFileTextInput(input);
  return file === undefined
    ? store.addText(taskId, input, textIndex, signal)
    : store.addLocalFile(taskId, file, signal);
}
