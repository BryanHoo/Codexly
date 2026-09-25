import { parseMarkdownIntoBlocks } from "streamdown";
import { describe, expect, it, vi } from "vitest";
import { AppendOnlyTextBuffer } from "../../lib/append-only-text.js";
import { createIncrementalMarkdownBlockParser as createTreeParser, type MarkdownBlockTree } from "./incremental-markdown-blocks.js";
import { IncrementalMessageResponseProcessor, normalizeMarkdownFileReferences, preprocessMessageResponse } from "./message-response-processing.js";

describe("Markdown 文件链接规范化", () => {
  it.each([
    ["[win](C:\\work\\main.ts:4)", "[win](/C:/work/main.ts:4)"],
    ["[unc](\\\\server\\share\\main.ts)", "[unc](/__codeagent_unc__/server/share/main.ts)"],
    ["[relative](src/main.ts:12:3)", "[relative](/__codeagent_relative__/src/main.ts:12:3)"],
    ["[space](/a b/main.ts) [tab](/a\tb/test.ts)", "[space](/a%20b/main.ts) [tab](/a%09b/test.ts)"],
    ["[a](src/a.ts)[b](src/b.ts)", "[a](/__codeagent_relative__/src/a.ts)[b](/__codeagent_relative__/src/b.ts)"],
    ["[web](https://example.com/a.ts) [anchor](#a.ts) [cdn](//host/a.ts)", "[web](https://example.com/a.ts) [anchor](#a.ts) [cdn](//host/a.ts)"],
    ["plain src/a.ts [unfinished](src/a.ts", "plain src/a.ts [unfinished](src/a.ts"],
  ])("保留前缀、行号与非文件链接：%s", (source, expected) => {
    expect(normalizeMarkdownFileReferences(source)).toBe(expected);
  });
});

function flattenBlocks(tree: MarkdownBlockTree): string[] {
  if (tree === null) return [];
  if (tree.items !== undefined) return tree.items.map((block) => block.content);
  return [...flattenBlocks(tree.left), ...flattenBlocks(tree.right)];
}

function createIncrementalMarkdownBlockParser(parse = parseMarkdownIntoBlocks) {
  const parser = createTreeParser(parse);
  return (response: ReturnType<IncrementalMessageResponseProcessor["process"]>) => flattenBlocks(parser(response));
}

describe("incremental message preprocessing", () => {
  it("preserves a pending link boundary across empty chunks", () => {
    const processor = new IncrementalMessageResponseProcessor();
    const buffer = new AppendOnlyTextBuffer("[file]");
    processor.process(buffer.getSnapshot());
    buffer.append("");
    processor.process(buffer.getSnapshot());
    buffer.append("(src/main.ts)");
    expect(processor.process(buffer.getSnapshot())).toMatchObject(preprocessMessageResponse("[file](src/main.ts)"));
  });

  it.each(["const values = [] ", "[file](src/main.ts:12) ", "[label] ordinary ", "[file](/tmp/"])(
    "does not rescan committed brackets or links in a growing line: %s", (prefix) => {
      const processor = new IncrementalMessageResponseProcessor();
      const buffer = new AppendOnlyTextBuffer(prefix);
      // oxlint-disable-next-line typescript/unbound-method -- 计数后显式恢复字符串 this。
      const matchAll = String.prototype.matchAll;
      let scanned = 0;
      const spy = vi.spyOn(String.prototype, "matchAll").mockImplementation(function (this: string, pattern) {
        scanned += this.length;
        return matchAll.call(this, pattern);
      });
      let response;
      try {
        for (let index = 0; index < 200; index += 1) {
          buffer.append("ordinary text ");
          response = processor.process(buffer.getSnapshot());
        }
      } finally {
        spy.mockRestore();
      }
      expect(response).toMatchObject(preprocessMessageResponse(prefix + "ordinary text ".repeat(200)));
      expect(scanned).toBeLessThan(10_000);
    },
  );

  it("does not rescan a growing ordinary line", () => {
    const processor = new IncrementalMessageResponseProcessor();
    const buffer = new AppendOnlyTextBuffer("");
    // oxlint-disable-next-line typescript/unbound-method -- 统计扫描量时通过 call 显式恢复字符串 this。
    const matchAll = String.prototype.matchAll;
    let scanned = 0;
    const spy = vi.spyOn(String.prototype, "matchAll").mockImplementation(function (this: string, pattern) {
      scanned += this.length;
      return matchAll.call(this, pattern);
    });
    try {
      for (let index = 0; index < 200; index += 1) {
        buffer.append("ordinary text ");
        processor.process(buffer.getSnapshot());
      }
    } finally {
      spy.mockRestore();
    }
    expect(scanned).toBeLessThan(10_000);
  });

  it.each(["ordinary text ", "const value = 1;\n"])("bounds repeated tail parsing: %s", (delta) => {
    const processor = new IncrementalMessageResponseProcessor();
    const buffer = new AppendOnlyTextBuffer(delta.includes("const") ? "```ts\n" : "");
    const parse = vi.fn(parseMarkdownIntoBlocks);
    const parseBlocks = createIncrementalMarkdownBlockParser(parse);
    for (let index = 0; index < 200; index += 1) {
      buffer.append(delta);
      parseBlocks(processor.process(buffer.getSnapshot()));
    }
    expect(parse.mock.calls.reduce((sum, [text]) => sum + text.length, 0)).toBeLessThan(10_000);
  });

  it("does not copy the complete historical block directory", () => {
    const processor = new IncrementalMessageResponseProcessor();
    const buffer = new AppendOnlyTextBuffer("");
    const parseBlocks = createIncrementalMarkdownBlockParser();
    const slice = Array.prototype.slice;
    let copied = 0;
    const spy = vi.spyOn(Array.prototype, "slice").mockImplementation(function (this: unknown[], start, end) {
      const result = slice.call(this, start, end);
      copied += result.length;
      return result;
    });
    try {
      for (let index = 0; index < 200; index += 1) {
        buffer.append("paragraph\n\n");
        parseBlocks(processor.process(buffer.getSnapshot()));
      }
    } finally {
      spy.mockRestore();
    }
    expect(copied).toBeLessThan(10_000);
  });

  it("consumes bounded chunk snapshots without requiring the full source", () => {
    const chunks = ["first\n\n", "[file](src/main.ts:12)"];
    const processor = new IncrementalMessageResponseProcessor();
    expect(processor.process({ chunks, chunkCount: 1 })).toMatchObject(preprocessMessageResponse(chunks[0]!));
    expect(processor.process({ chunks, chunkCount: 2 })).toMatchObject(preprocessMessageResponse(chunks.join("")));
  });

  it.each([
    "  first\n\n\nsecond\n\nHeading\n===\n\n- first\n- second\n",
    "[file](src/main.ts:12)\n\n[win](C:\\work\\main.ts:4)\n\n[space](/a b/file.ts:2)",
    'before\n\n::code-comment{file="src/main.ts" title="Issue" body="Fix it" start=2}\n\n\nafter',
    "```ts\nconst value = 1;\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nend",
    "text[^note]\n\nparagraph\n\n[^note]: definition\n\nend",
    "你好 😀\r\n\r\n> quote\n> continued\n\nend",
    "```ts\nconst template = `value`;\nconst ticks = '```';\n```\n\nDone",
    "~~~~js\nconst template = `value`;\n~~~\n~~~~\n\nDone",
    "A plain paragraph that becomes **bold** and a link www.example.com",
    "prefix ::code-comment{file=\"a.ts\" title=\"literal\" body=\"text\"}\n\nend",
    " A leading space\n\n::code-comment{file=\"a.ts\" title=\"issue\" body=\"text\"}\n\n    Next\n\nAfter",
    "const values = [] + rows[index] + [other]; [file](src/a.ts) then [next](/a b/main.ts:2) end]",
    "[unfinished](src/a.ts\rplain] text [nested](src/[name].ts) end",
  ])("matches full preprocessing across every character boundary: %s", (source) => {
    const buffer = new AppendOnlyTextBuffer("");
    const processor = new IncrementalMessageResponseProcessor();
    const parseBlocks = createIncrementalMarkdownBlockParser();
    let previousMarkdown = "";
    let input = "";
    for (const character of source) {
      input += character;
      buffer.append(character);
      const response = processor.process(buffer.getSnapshot());
      expect(response).toMatchObject(preprocessMessageResponse(input));
      expect(previousMarkdown.slice(0, response.replaceFrom) + response.replacement).toBe(response.markdown);
      const blocks = parseBlocks(response);
      expect(blocks.join("")).toBe(response.markdown.replace(/\r\n?/g, "\n"));
      const expectedBlocks = /\[\^[\w-]{1,200}\]/.test(response.markdown)
        ? [response.markdown]
        : parseMarkdownIntoBlocks(response.markdown);
      expect(blocks).toEqual(expectedBlocks);
      previousMarkdown = response.markdown;
    }
  });

  it("processes code containing template literals without re-parsing the growing fence", () => {
    const processor = new IncrementalMessageResponseProcessor();
    const buffer = new AppendOnlyTextBuffer("```ts\n");
    const parse = vi.fn(parseMarkdownIntoBlocks);
    const parser = createTreeParser(parse);
    for (let index = 0; index < 200; index += 1) {
      buffer.append("const value = `template`;\n");
      parser(processor.process(buffer.getSnapshot()));
    }
    expect(parse.mock.calls.reduce((sum, [text]) => sum + text.length, 0)).toBeLessThan(10_000);
  });

  it("does not split the complete source of a growing code line", () => {
    const processor = new IncrementalMessageResponseProcessor();
    const buffer = new AppendOnlyTextBuffer("```ts\n");
    const parser = createTreeParser();
    // oxlint-disable-next-line typescript/unbound-method -- 保留原 split，并在计数后显式绑定 this。
    const split = String.prototype.split;
    let scanned = 0;
    const spy = vi.spyOn(String.prototype, "split").mockImplementation(function (this: string, separator, limit) {
      scanned += this.length;
      return split.call(this, separator, limit);
    });
    try {
      for (let index = 0; index < 200; index += 1) {
        buffer.append("value + ");
        parser(processor.process(buffer.getSnapshot()));
      }
    } finally {
      spy.mockRestore();
    }
    expect(scanned).toBeLessThan(10_000);
  });

  it("handles skipped snapshots, replay, replacement and repeated reads", () => {
    const buffer = new AppendOnlyTextBuffer("first\n\n");
    const first = buffer.getSnapshot();
    const processor = new IncrementalMessageResponseProcessor();
    const parseBlocks = createIncrementalMarkdownBlockParser();
    parseBlocks(processor.process(first));
    buffer.append("second\n\n");
    buffer.append("third");
    const latest = processor.process(buffer.getSnapshot());
    expect(parseBlocks(latest).join("")).toBe("first\n\nsecond\n\nthird");
    expect(processor.process(buffer.getSnapshot())).toBe(latest);
    expect(parseBlocks(processor.process(first))).toEqual(["first"]);
    expect(parseBlocks(processor.process("replacement"))).toEqual(["replacement"]);
    expect(parseBlocks(processor.process(""))).toEqual([]);
  });

  it("reads each source chunk once and bounds parser input to the changing tail", () => {
    const chunks: string[] = [];
    let reads = 0;
    const source = new Proxy(chunks, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const processor = new IncrementalMessageResponseProcessor();
    const parse = vi.fn(parseMarkdownIntoBlocks);
    const parseBlocks = createIncrementalMarkdownBlockParser(parse);
    for (let index = 0; index < 200; index += 1) {
      chunks.push("paragraph\n\n");
      parseBlocks(processor.process({ chunks: source, chunkCount: chunks.length }));
    }
    expect(reads).toBe(200);
    expect(parse.mock.calls.reduce((sum, [text]) => sum + text.length, 0)).toBeLessThan(200 * 40);
  });
});
