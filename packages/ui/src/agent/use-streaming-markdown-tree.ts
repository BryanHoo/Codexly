import { startTransition, useEffect, useMemo, useState } from "react";
import { parseMarkdownBlocks } from "./markdown-block-lexer.js";
import {
  createIncrementalMarkdownBlockParser,
  type MarkdownBlockTree,
  type MarkdownBlockUpdate,
} from "@codexly/frontend-core/incremental-markdown-blocks";
import { finalizeMarkdownInWorker } from "./markdown-finalization.js";

export function useStreamingMarkdownTree(
  response: MarkdownBlockUpdate,
  streaming: boolean,
  enabled: boolean,
) {
  const parser = useMemo(() => createIncrementalMarkdownBlockParser(parseMarkdownBlocks), []);
  const tree = useMemo(
    () => (enabled ? parser(response, streaming) : null),
    [enabled, parser, response, streaming],
  );
  const [settled, setSettled] = useState<{
    response: MarkdownBlockUpdate;
    tree: MarkdownBlockTree;
  } | null>(null);

  useEffect(() => {
    if (!enabled || streaming) return;
    const controller = new AbortController();
    // 大块解析从提交后的任务启动，渲染阶段继续显示原预览；结果以低优先级更新尾部。
    void parser
      .finalize(finalizeMarkdownInWorker, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && result !== tree) {
          startTransition(() => {
            setSettled({ response, tree: result });
          });
        }
      })
      .catch((error: unknown) => {
        // 加载失败时保留完整可读预览，禁止退回主线程同步解析超大正文。
        if (!controller.signal.aborted) console.error("Markdown finalization failed", error);
      });
    return () => {
      controller.abort();
    };
  }, [enabled, parser, response, streaming, tree]);

  return enabled && !streaming && settled?.response === response ? settled.tree : tree;
}
