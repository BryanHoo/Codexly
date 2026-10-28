import type { TextSnapshot } from "./append-only-text.js";

export function hasReasoningSummary(summary: string | undefined): boolean {
  // 两端只在摘要含非空白文字时创建展示入口，流式占位仍保留在 Store 中等待后续增量。
  return (summary?.trim().length ?? 0) > 0;
}

export function getReasoningBody(summary: string): string {
  // 仅移除开头独占一行的 Markdown 标题或加粗标题；普通首段、代码和后续小节保持原样。
  const title =
    /^(?:[ \t]*\r?\n)* {0,3}(?:#{1,6}[ \t]+\S[^\r\n]*|(\*\*|__)\S[^\r\n]*?\1[ \t]*)(?:\r?\n|$)/u.exec(
      summary,
    );
  return title === null
    ? summary
    : summary.slice(title[0].length).replace(/^(?:[ \t]*\r?\n)+/u, "");
}

interface ReasoningBodyCache {
  offset: number;
  remaining: number;
  chunks: string[];
  snapshot: TextSnapshot;
}

// 缓存随源 Chunk 数组释放；每个流仅保留当前标题偏移，不按历史偏移累积缓存。
const reasoningBodies = new WeakMap<readonly string[], ReasoningBodyCache>();

export function getReasoningBodySource(source: TextSnapshot, offset: number): TextSnapshot {
  if (offset === 0) return source;
  let cache = reasoningBodies.get(source.chunks);
  if (cache === undefined || cache.offset !== offset) {
    const chunks: string[] = [];
    cache = { offset, remaining: offset, chunks, snapshot: { chunks, chunkCount: 0 } };
    reasoningBodies.set(source.chunks, cache);
  }
  // 与原始快照保持相同 Chunk 索引，只处理新增片段，避免每次 Token 到达时复制完整正文。
  while (cache.chunks.length < source.chunkCount) {
    const chunk = source.chunks[cache.chunks.length] ?? "";
    cache.chunks.push(chunk.slice(cache.remaining));
    cache.remaining = Math.max(0, cache.remaining - chunk.length);
  }
  if (cache.snapshot.chunkCount !== source.chunkCount) {
    cache.snapshot = { chunks: cache.chunks, chunkCount: source.chunkCount };
  }
  return cache.snapshot;
}

export function getReasoningBodyProps(summary: string, source?: TextSnapshot) {
  const children = getReasoningBody(summary);
  // 正文和增量快照必须采用同一偏移，防止异步 Markdown 加载后重新展示重复标题。
  return {
    children,
    ...(source === undefined
      ? {}
      : { textSource: getReasoningBodySource(source, summary.length - children.length) }),
  };
}
