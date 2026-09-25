import { bench, describe } from "vitest";
import { createIncrementalMarkdownBlockParser } from "../src/shared/components/agent/incremental-markdown-blocks.js";
import type { ProcessedMessageResponse } from "../src/shared/components/agent/message-response-processing.js";

// 直接调用生产分块器，仅统计整段流的累计耗时，不把该数值当作单帧延迟。
for (const count of [1_000, 2_000, 4_000]) {
  describe(`${count} appends`, () => {
    for (const [name, delta] of [["bold paragraph", "**bold** long paragraph text "], ["continuous list", "- **bold** list item\n"]]) {
      bench(name!, () => {
        const parser = createIncrementalMarkdownBlockParser();
        let response: ProcessedMessageResponse = { markdown: "", comments: [], replaceFrom: 0, replacement: "" };
        for (let index = 0; index < count; index += 1) {
          response = { markdown: response.markdown + delta!, comments: [], replaceFrom: response.markdown.length, replacement: delta! };
          parser(response);
        }
      }, { iterations: 3, time: 0, warmupIterations: 1, warmupTime: 0 });
    }
  });
}
