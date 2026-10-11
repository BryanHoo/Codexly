import type * as React from "react";
import type * as Streamdown from "streamdown";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { replaceSequenceTail } from "@codexly/frontend-core/persistent-sequence";
import {
  appendMarkdownBlock,
  createMarkdownBlock,
  type MarkdownBlock,
} from "@codexly/frontend-core/streaming-markdown-block";
import { StreamingMarkdown } from "@codexly/ui/agent/streaming-markdown";

const subscriptions = vi.hoisted(() => ({ values: [] as unknown[] }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof React>();
  return {
    ...react,
    useContext: <T,>(context: React.Context<T>) => {
      const value = react.useContext(context);
      subscriptions.values.push(value);
      return value;
    },
  };
});

vi.mock("streamdown", async (importOriginal) => {
  const streamdown = await importOriginal<typeof Streamdown>();
  // 只替换第三方外壳，让测试直接观察共享树与叶节点的真实 Context 订阅。
  return {
    ...streamdown,
    Streamdown: ({ BlockComponent }: Streamdown.StreamdownProps) =>
      BlockComponent ? (
        <BlockComponent
          content=""
          index={0}
          shouldParseIncompleteMarkdown
          shouldNormalizeHtmlIndentation
          isIncomplete
        />
      ) : null,
  };
});

function renderSubscriptions(block: MarkdownBlock, isAnimating: boolean) {
  subscriptions.values = [];
  const tree = replaceSequenceTail(null, 0, [block]);
  const markup = renderToStaticMarkup(
    <StreamingMarkdown tree={tree} fast enabled isAnimating={isAnimating} />,
  );
  // 固定单个纯文本块：桥接层、Markdown 块各读取一次，之后均为文本叶节点。
  return { markup, leaves: subscriptions.values.slice(2) };
}

describe("共享流式文本的订阅边界", () => {
  beforeEach(() => {
    subscriptions.values = [];
  });

  it.each([false, true])("追加正文不改变历史叶节点的订阅值：动画=%s", (animate) => {
    const history = "历史正文".repeat(9_000);
    const block = createMarkdownBlock(history, history);
    const appended = appendMarkdownBlock(block, "新增正文");
    if (appended === null) throw new Error("纯文本追加应保留流式快路径");
    const before = renderSubscriptions(block, animate);
    const after = renderSubscriptions(appended, animate);

    expect(before.leaves.length).toBeGreaterThan(32);
    expect(after.markup).toContain("新增正文");
    // React 用 Object.is 决定是否通知 Context 消费者；DOM 相同无法证明没有重复渲染。
    expect(before.leaves.every((value, index) => Object.is(value, after.leaves[index]))).toBe(true);
  });

  it("切换动画状态仍通知文本叶节点", () => {
    const block = createMarkdownBlock("正文", "正文");
    const before = renderSubscriptions(block, true);
    const after = renderSubscriptions(block, false);

    expect(before.leaves).toHaveLength(1);
    expect(after.leaves).toHaveLength(1);
    expect(Object.is(before.leaves[0], after.leaves[0])).toBe(false);
  });
});
