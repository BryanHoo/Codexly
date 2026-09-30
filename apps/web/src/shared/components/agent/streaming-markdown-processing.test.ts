import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { expect, it, vi } from "vitest";

import {
  IncrementalMessageResponseProcessor,
  preprocessMessageResponse,
} from "./message-response-processing.js";

it.each([
  "结论： **本地实现。**准确说。 __再次修复！__还有。",
  "a**不修复。**中文 \\**不修复。**中文 **正常。**中文",
  "\\**__`[link](src/main.ts)**中文",
  "``**\n中`\\\r\t\r __`。**。word 中\t__`word **__中",
  "``__[link](src/main.ts)``",
  "[link](src/main.ts)\t\t **`__`__[link](src/main.ts)",
  "__`[link](src/main.ts)`",
  "***嵌套。***中文 ****嵌套。****中文 **不完整",
  "`**代码。**继续` **正文。**继续 ``**代码。**继续``",
  "`未闭合 **正文。**继续 最后` **正常。**继续",
  "  ```md\n**围栏。**继续\n  ```\n**正文。**继续",
  "   ~~~~md\n**围栏。**继续\n   ~~~~\n**正文。**继续",
  "    **缩进。**继续\n\t**缩进。**继续\n**正文。**继续",
  '开头\n\n::code-comment{file="a.ts" title="Issue" body="Fix" start=2}\n\n\n**正文。**继续',
  "[文件](C:\\a b\\main.ts:4) **正文。**继续 [文件](src/main.ts:2)",
  "[文件](/tmp/very-long-" + "path".repeat(100) + "/main.ts) **正文。**继续",
  "你好 😀\r\n\r\n**正文。**继续\n\n结束",
])("preserves Web preprocessing and emitted patches at every boundary: %s", (source) => {
  const processor = new IncrementalMessageResponseProcessor();
  const buffer = new AppendOnlyTextBuffer("");
  let input = "";
  let previous = "";
  for (const character of source) {
    input += character;
    buffer.append(character);
    const response = processor.process(buffer.getSnapshot());
    expect(response).toMatchObject(preprocessMessageResponse(input));
    expect(previous.slice(0, response.replaceFrom) + response.replacement).toBe(response.markdown);
    previous = response.markdown;
  }
});

it.each(["ordinary text ", "**bold** words ", "**正文。**继续 "])(
  "bounds cumulative text scanning in a growing line: %s",
  (delta) => {
    const buffer = new AppendOnlyTextBuffer("");
    const processor = new IncrementalMessageResponseProcessor();
    // oxlint-disable-next-line typescript/unbound-method -- 计数后通过 call 恢复字符串 this。
    const matchAll = String.prototype.matchAll;
    let scanned = 0;
    const spy = vi.spyOn(String.prototype, "matchAll").mockImplementation(function (
      this: string,
      pattern,
    ) {
      scanned += this.length;
      return matchAll.call(this, pattern);
    });
    let response;
    try {
      for (let index = 0; index < 1_000; index += 1) {
        buffer.append(delta);
        response = processor.process(buffer.getSnapshot());
      }
    } finally {
      spy.mockRestore();
    }
    expect(response).toMatchObject(preprocessMessageResponse(delta.repeat(1_000)));
    expect(scanned).toBeLessThan(150_000);
  },
);

it("handles skipped snapshots, empty chunks, replay and replacement", () => {
  const processor = new IncrementalMessageResponseProcessor();
  const buffer = new AppendOnlyTextBuffer("first\n\n");
  const first = buffer.getSnapshot();
  processor.process(first);
  buffer.append("**正文。**");
  buffer.append("继续");
  const latest = processor.process(buffer.getSnapshot());
  expect(latest).toMatchObject(preprocessMessageResponse(buffer.materialize()));
  buffer.append("");
  expect(processor.process(buffer.getSnapshot())).toBe(latest);
  expect(processor.process(first)).toMatchObject(preprocessMessageResponse("first\n\n"));
  expect(processor.process("replacement")).toMatchObject(preprocessMessageResponse("replacement"));
});

it("matches full preprocessing for deterministic mixed-syntax streams", () => {
  const tokens = [
    "**",
    "__",
    "word ",
    "中",
    "。",
    " ",
    "`",
    "``",
    "\\",
    "\t",
    "\n",
    "\r",
    "[link](src/main.ts)",
  ];
  let seed = 17;
  for (let trial = 0; trial < 1_000; trial += 1) {
    let source = "";
    for (let index = 0; index < 24; index += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      source += tokens[seed % tokens.length] ?? "";
    }
    const buffer = new AppendOnlyTextBuffer("");
    const processor = new IncrementalMessageResponseProcessor();
    let input = "";
    let previous = "";
    for (const character of source) {
      input += character;
      buffer.append(character);
      const response = processor.process(buffer.getSnapshot());
      expect(response.markdown, input).toBe(preprocessMessageResponse(input).markdown);
      expect(previous.slice(0, response.replaceFrom) + response.replacement).toBe(
        response.markdown,
      );
      previous = response.markdown;
    }
  }
});
