import { expect, it, vi } from "vitest";
import {
  createIncrementalMarkdownBlockParser,
  parseFinalMarkdownBlocks,
} from "./incremental-markdown-blocks.js";
import { sequenceItem } from "./persistent-sequence.js";

const parse = (source: string) => source.match(/[^]+?(?:\n\n|$)/g) ?? [];
const response = (markdown: string, replaceFrom = 0, replacement = markdown) => ({
  markdown,
  replaceFrom,
  replacement,
  comments: [],
});

it("结束时保留稳定块和已解析尾块，不再解析全文", () => {
  const lexer = vi.fn(parse);
  const parser = createIncrementalMarkdownBlockParser(lexer);
  const input = response("# 标题\n\n第一段\n\n最后一段");
  const before = parser(input);
  lexer.mockClear();
  const after = parser(input, false);
  expect(lexer).not.toHaveBeenCalled();
  expect(after).toBe(before);
  expect(sequenceItem(after, 0)).toBe(sequenceItem(before, 0));
});

it("结束时仅解析延迟尾块，保留历史块身份", () => {
  const lexer = vi.fn(parse);
  const parser = createIncrementalMarkdownBlockParser(lexer);
  const source = "# 标题\n\n**尾部** ";
  const before = parser(response(source));
  const addition = "追加".repeat(1_100);
  const input = response(source + addition, source.length, addition);
  parser(input);
  lexer.mockClear();
  const after = parser(input, false);
  expect(lexer.mock.calls.map(([text]) => text)).toEqual(["**尾部** " + addition]);
  expect(sequenceItem(after, 0)).toBe(sequenceItem(before, 0));
});

it("超大尾块在结束渲染阶段保持预览，不同步调用 lexer", () => {
  const lexer = vi.fn(parse);
  const parser = createIncrementalMarkdownBlockParser(lexer);
  const source = "- **列表项**\n".repeat(85_000);
  const input = response(source);
  const before = parser(input);
  const after = parser(input, false);
  expect(lexer.mock.calls.length).toBe(0);
  expect(sequenceItem(after, 0)?.kind).toBe("deferred");
  expect(after).toBe(before);
});

it.each(["replacement", "resume", "abort"])("丢弃异步收尾的过期结果：%s", async (change) => {
  const parser = createIncrementalMarkdownBlockParser(parse);
  const input = response("- **列表项**\n".repeat(2_000));
  parser(input, false);
  let resolve!: (blocks: ReturnType<typeof parseFinalMarkdownBlocks>) => void;
  const controller = new AbortController();
  const result = parser.finalize(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    controller.signal,
  );
  let expected;
  if (change === "replacement") expected = parser(response("新回复"), false);
  else if (change === "resume") expected = parser(input, true);
  else {
    controller.abort();
    expected = parser(input, false);
  }
  resolve(parseFinalMarkdownBlocks(input.markdown, parse));
  expect(await result).toBe(expected);
});

it("异步收尾只传入尾部并保留历史块引用", async () => {
  const parser = createIncrementalMarkdownBlockParser(parse);
  const prefix = "# 标题\n\n**尾部** ";
  const before = parser(response(prefix));
  const addition = "- **列表项**\n".repeat(2_000);
  const input = response(prefix + addition, prefix.length, addition);
  parser(input, false);
  const asynchronous = vi.fn((source: string) =>
    Promise.resolve(parseFinalMarkdownBlocks(source, parse)),
  );
  const final = await parser.finalize(asynchronous, new AbortController().signal);
  expect(asynchronous.mock.calls.map(([source]) => source.length)).toEqual([
    "**尾部** ".length + addition.length,
  ]);
  expect(sequenceItem(final, 0)).toBe(sequenceItem(before, 0));
  expect(sequenceItem(final, 1)?.source).toBe("**尾部** " + addition);
});

it("收尾仍保留 CRLF 源码和脚注的全文作用域", async () => {
  const parser = createIncrementalMarkdownBlockParser(parse);
  const source = "# 标题\r\n\r\n" + "text[^note]\r\n".repeat(1_000) + "\r\n[^note]: 说明";
  parser(response(source), false);
  const final = await parser.finalize(
    (tail) => Promise.resolve(parseFinalMarkdownBlocks(tail, parse)),
    new AbortController().signal,
  );
  expect(final?.size).toBe(1);
  expect(sequenceItem(final, 0)?.source).toBe(source);
  expect(sequenceItem(final, 0)?.content).toBe(source);
});

it("最后一次快照携带增量时正确收尾，未闭合代码交还完整渲染", () => {
  const parser = createIncrementalMarkdownBlockParser(parse);
  const source = "# 标题\n\n```ts\nconst a = ";
  const before = parser(response(source));
  const final = parser(response(source + "1", source.length, "1"), false);
  expect(sequenceItem(final, 0)).toBe(sequenceItem(before, 0));
  expect(sequenceItem(final, 1)).toEqual({
    kind: "markdown",
    content: "```ts\nconst a = 1",
    source: "```ts\nconst a = 1",
  });
});
