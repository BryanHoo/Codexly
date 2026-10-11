import type { AgentMessageAttachment } from "@codexly/protocol";

import type { MapCodexMessageImage, MapCodexMessageText } from "./codex-message-mapping.js";
import type { HistoricalAttachmentResult } from "./persistent-historical-attachment-store.js";

type ImageArguments = [taskId: string, part: Record<string, unknown>, imageIndex: number];
type TextArguments = [
  taskId: string,
  input: Readonly<{ name: string; text: string }>,
  textIndex: number,
];
type Mapper<Arguments extends unknown[], Result> = (...args: Arguments) => Result;

export function resolveAttachmentMapping<T>(
  map: (
    mapImage: Mapper<ImageArguments, AgentMessageAttachment | undefined>,
    mapText: Mapper<TextArguments, AgentMessageAttachment | undefined>,
  ) => T,
  mapImage: Mapper<ImageArguments, HistoricalAttachmentResult>,
  mapText: Mapper<TextArguments, HistoricalAttachmentResult>,
): T | Promise<T> {
  const results: HistoricalAttachmentResult[] = [];
  function collect<Arguments extends unknown[]>(
    mapper: Mapper<Arguments, HistoricalAttachmentResult>,
  ) {
    return (...args: Arguments): AgentMessageAttachment | undefined => {
      const result = mapper(...args);
      results.push(result);
      if (result instanceof Promise) {
        return undefined;
      }
      return result;
    };
  }
  const mapped = map(collect(mapImage), collect(mapText));
  if (!results.some((result) => result instanceof Promise)) return mapped;
  // 原生协议映射保持同步且纯粹：首遍收集附件，正文落盘后只用解析结果再投影元数据。
  // 按调用次序缓存，第二遍不会重复读取文件、解码或提交 Worker；无附件的事件仍同步交付。
  return Promise.all(results.map((result) => Promise.resolve(result))).then((resolved) => {
    let index = 0;
    const next = () => resolved[index++];
    return map(next, next);
  });
}

export function resolveTaskAttachmentMapping<T>(
  taskId: string,
  map: (image: MapCodexMessageImage, text: MapCodexMessageText) => T,
  mapImage: Mapper<ImageArguments, HistoricalAttachmentResult>,
  mapText: Mapper<TextArguments, HistoricalAttachmentResult>,
): T | Promise<T> {
  return resolveAttachmentMapping(
    (image, text) =>
      map(
        (part, index) => image(taskId, part, index),
        (input, index) => text(taskId, input, index),
      ),
    mapImage,
    mapText,
  );
}
