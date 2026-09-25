import { bench, describe } from "vitest";
import { createTaskItemStore } from "../src/features/conversation/runtime/task-store-core.js";
import { IncrementalMessageResponseProcessor } from "../src/shared/components/agent/message-response-processing.js";
import { createIncrementalMarkdownBlockParser } from "../src/shared/components/agent/incremental-markdown-blocks.js";

const options = { iterations: 5, time: 0, warmupIterations: 2, warmupTime: 0 };
const delta = {
  version: 2 as const, provider: "codex" as const, sessionId: "s", taskId: "t",
  turnId: "turn", itemId: "message", sequence: 1, timestamp: "2026-09-05T00:00:00Z",
  type: "message.delta" as const, payload: { delta: "A streamed response line.\n\n" },
};

for (const count of [2_000, 4_000, 8_000]) {
  describe(`${count} appends`, () => {
    bench("append and read", () => {
      const store = createTaskItemStore({ id: "message", type: "message", role: "assistant", text: "" });
      for (let index = 0; index < count; index += 1) {
        store.appendDelta(delta);
        store.read();
      }
    }, options);

    bench("append, read, preprocess and split blocks", () => {
      const store = createTaskItemStore({ id: "message", type: "message", role: "assistant", text: "" });
      const processor = new IncrementalMessageResponseProcessor();
      const parseBlocks = createIncrementalMarkdownBlockParser();
      for (let index = 0; index < count; index += 1) {
        store.appendDelta(delta);
        store.read();
        parseBlocks(processor.process(store.readText()!));
      }
    }, options);

    for (const [name, initial, text] of [
      ["long paragraph", "", "ordinary text "],
      ["open code fence", "```ts\n", "const value = `template`;\n"],
      ["long code line", "```ts\n", "value + "],
      ["long code line after bracket", "```ts\nconst values = []; ", "values[index] + "],
      ["long paragraph after file link", "[file](src/main.ts:12) ", "ordinary text "],
      ["unfinished file link", "[file](/tmp/", "ordinary text "],
    ]) {
      bench(name!, () => {
        const store = createTaskItemStore({ id: "message", type: "message", role: "assistant", text: initial! });
        const processor = new IncrementalMessageResponseProcessor();
        const parseBlocks = createIncrementalMarkdownBlockParser();
        const event = { ...delta, payload: { delta: text! } };
        for (let index = 0; index < count; index += 1) {
          store.appendDelta(event);
          store.read();
          parseBlocks(processor.process(store.readText()!));
        }
      }, options);
    }
  });
}
