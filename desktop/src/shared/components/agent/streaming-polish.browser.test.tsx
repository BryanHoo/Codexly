import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { BlockProps } from "streamdown";
import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { MessageResponse } from "./message-response.js";
import { AgentEntry, AgentMotionProvider } from "@codexly/ui/agent/motion";
import "@codexly/ui/agent/streaming-markdown.css";

const blockRenders = vi.hoisted(() => new Map<string, number>());
vi.mock("streamdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("streamdown")>();
  return {
    ...original,
    // 计数共享树调用块渲染器的次数，不能仅凭 DOM 复用推断没有重复 React 工作。
    Block: (props: BlockProps) => {
      blockRenders.set(props.content, (blockRenders.get(props.content) ?? 0) + 1);
      return <original.Block {...props} />;
    },
  };
});

afterEach(() => {
  blockRenders.clear();
  vi.restoreAllMocks();
});

describe("共享流式正文性能与动效", () => {
  it("追加尾部时不再调用已完成 Markdown 块的渲染器", async () => {
    const buffer = new AppendOnlyTextBuffer(
      Array.from({ length: 128 }, (_, index) => `**完成段落 ${index}**\n\n`).join("") + "尾部",
    );
    const screen = await render(
      <MessageResponse textSource={buffer.getSnapshot()} mode="streaming" isAnimating />,
    );
    const first = screen.container.querySelector("p");
    expect([...blockRenders.keys()].filter((content) => content.includes("完成段落"))).toHaveLength(
      128,
    );
    blockRenders.clear();
    buffer.append("继续输出");
    await screen.rerender(
      <MessageResponse textSource={buffer.getSnapshot()} mode="streaming" isAnimating />,
    );
    expect(screen.container.querySelector("p")).toBe(first);
    expect(screen.container.textContent).toContain("尾部继续输出");
    expect([...blockRenders.keys()].filter((content) => content.includes("完成段落"))).toEqual([]);
  });

  it("每次追加只为新文字启动淡入并保留段落身份", async () => {
    const buffer = new AppendOnlyTextBuffer("第一批文字");
    const screen = await render(
      <MessageResponse textSource={buffer.getSnapshot()} mode="streaming" isAnimating />,
    );
    const paragraph = screen.container.querySelector("p");
    const initial = screen.container.querySelector("[data-streaming-text-reveal]");
    buffer.append("第二批文字");
    await screen.rerender(
      <MessageResponse textSource={buffer.getSnapshot()} mode="streaming" isAnimating />,
    );
    const second = screen.container.querySelector("[data-streaming-text-reveal]");
    expect(second?.textContent).toBe("第二批文字");
    expect(second).not.toBe(initial);
    buffer.append("第三批文字");
    await screen.rerender(
      <MessageResponse textSource={buffer.getSnapshot()} mode="streaming" isAnimating />,
    );
    expect(screen.container.querySelector("[data-streaming-text-reveal]")).not.toBe(second);
    expect(screen.container.querySelector("p")).toBe(paragraph);
    expect(paragraph?.textContent).toBe("第一批文字第二批文字第三批文字");
    const reveal = screen.container.querySelector<HTMLElement>("[data-streaming-text-reveal]")!;
    expect(getComputedStyle(reveal).animationName).toBe("agent-text-reveal");
    const animation = reveal.getAnimations()[0]!;
    expect(animation).toBeDefined();
    const frames = (animation.effect as KeyframeEffect).getKeyframes();
    expect(Number(frames[0]?.opacity)).toBeGreaterThan(0);
    await screen.rerender(
      <MessageResponse textSource={buffer.getSnapshot()} mode="static" isAnimating={false} />,
    );
    expect(screen.container.querySelector("[data-streaming-text-reveal]")).toBeNull();
  });

  it("静态模式优先于残留的运行标记，不为历史正文创建入场包装", async () => {
    const buffer = new AppendOnlyTextBuffer("已完成的历史正文");
    const screen = await render(
      <MessageResponse textSource={buffer.getSnapshot()} mode="static" isAnimating />,
    );
    expect(screen.container.textContent).toContain("已完成的历史正文");
    expect(screen.container.querySelector("[data-streaming-text-reveal]")).toBeNull();
  });
});

function Entries({ ids }: { ids: string[] }) {
  return (
    <AgentMotionProvider>
      {ids.map((id) => (
        <AgentEntry key={id} animationKey={id} live>
          {id}
        </AgentEntry>
      ))}
    </AgentMotionProvider>
  );
}

describe("共享入场动画生命周期", () => {
  it("同批新增步骤立即可读，不按顺序等待入场", async () => {
    const screen = await render(<Entries ids={[]} />);
    await screen.rerender(<Entries ids={["步骤一", "步骤二", "步骤三"]} />);
    const animations = screen.container.getAnimations({ subtree: true });
    expect(animations).toHaveLength(3);
    for (const animation of animations) {
      expect(animation.effect?.getTiming().delay).toBe(0);
      const frames = (animation.effect as KeyframeEffect).getKeyframes();
      expect(Number(frames[0]?.opacity)).toBeGreaterThan(0);
    }
  });

  it("隐藏页面取消入场，后台追加和恢复可见不补播", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const screen = await render(<Entries ids={["历史"]} />);
    expect(screen.container.getAnimations({ subtree: true })).toHaveLength(0);
    await screen.rerender(<Entries ids={["历史", "前台新增"]} />);
    const animation = screen.container.getAnimations({ subtree: true })[0]!;
    expect(animation).toBeDefined();
    // 暂停真实动画消除执行速度依赖，验证隐藏事件确实取消，而非自然结束。
    animation.pause();
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(animation.playState).toBe("idle");
    await screen.rerender(<Entries ids={["历史", "前台新增", "后台新增"]} />);
    expect(screen.container.getAnimations({ subtree: true })).toHaveLength(0);
    expect(screen.container.textContent).toContain("后台新增");
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await screen.rerender(<Entries ids={["历史", "前台新增", "后台新增"]} />);
    expect(screen.container.getAnimations({ subtree: true })).toHaveLength(0);
    await screen.rerender(<Entries ids={["历史", "前台新增", "后台新增", "恢复后新增"]} />);
    expect(screen.container.getAnimations({ subtree: true })).toHaveLength(1);
  });
});
