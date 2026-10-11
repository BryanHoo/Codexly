import { parseMarkdownBlocks } from "./markdown-block-lexer.js";
import { parseFinalMarkdownBlocks } from "@codexly/frontend-core/incremental-markdown-blocks";

// Worker 与两端使用同一个 lexer，避免按字符硬切列表、围栏或脚注而改变 Markdown 语义。
globalThis.onmessage = (event: MessageEvent<string>) => {
  try {
    globalThis.postMessage({
      blocks: parseFinalMarkdownBlocks(event.data, parseMarkdownBlocks),
    });
  } catch (error) {
    globalThis.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
