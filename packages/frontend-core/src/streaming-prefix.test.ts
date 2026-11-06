import { expect, it } from "vitest";
import { createIncrementalMarkdownBlockParser } from "./incremental-markdown-blocks.js";
import { AppendOnlyTextBuffer } from "./append-only-text.js";
import { IncrementalMessageResponseProcessor } from "./incremental-message-response.js";
import { sequenceItem } from "./persistent-sequence.js";
import { createMarkdownBlock, deferMarkdownBlock } from "./streaming-markdown-block.js";

it.each(["我", "我已确认", "**已确认**", "我\r\n"])(
  "延迟解析不能把未结束段落的前缀独立保留：%s",
  (prefix) => {
    const block = createMarkdownBlock(prefix, prefix);
    const source = prefix + "后续正文".repeat(3000);
    const deferred = deferMarkdownBlock(block, source, prefix.length, source.slice(prefix.length));
    expect(deferred.content).toBe("");
    expect(deferred.source).toBe(source);
  },
);

it("单字流式前缀在权威正文替换后完全清除", () => {
  const processor = new IncrementalMessageResponseProcessor({
    parseComment: () => null,
    normalizeReferences: (s) => s,
  });
  const parser = createIncrementalMarkdownBlockParser((s) => [s]);
  const first = new AppendOnlyTextBuffer("我");
  parser(processor.process(first.getSnapshot()));
  const final = new AppendOnlyTextBuffer(
    "已定位并复现，是 **Web 端处理 diff 的缺陷**。\n\n解释正文。",
  );
  const tree = parser(processor.process(final.getSnapshot()), false);
  expect(sequenceItem(tree, 0)?.source).toBe(final.materialize());
  expect(tree?.size).toBe(1);
});
