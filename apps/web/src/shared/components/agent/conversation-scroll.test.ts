import { describe, expect, it, vi } from "vitest";

import { createConversationAutoScrollController } from "./conversation-scroll.js";

type ScrollTarget = Parameters<
  ReturnType<typeof createConversationAutoScrollController>["handleScroll"]
>[0];

function createScrollTarget({
  clientHeight = 400,
  scrollHeight = 1_000,
  scrollTop = 600,
}: {
  clientHeight?: number;
  scrollHeight?: number;
  scrollTop?: number;
} = {}) {
  return {
    clientHeight,
    scrollHeight,
    scrollTo: vi.fn(),
    scrollTop,
  } satisfies ScrollTarget;
}

describe("conversation auto scroll", () => {
  it("follows new content while the user remains at the bottom", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget({ scrollHeight: 1_200 });

    controller.handleContentResize(scrollTarget);

    expect(scrollTarget.scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1_200 });
    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
  });

  it("does not mistake a large content height increase for a user scroll", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget();

    controller.handleContentResize(scrollTarget);
    scrollTarget.scrollTo.mockClear();

    // 大段回复可能先触发 scroll，再触发 ResizeObserver，此时旧 scrollTop 会暂时远离底部。
    scrollTarget.scrollHeight = 1_800;
    controller.handleScroll(scrollTarget);
    controller.handleContentResize(scrollTarget);

    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
    expect(scrollTarget.scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1_800 });
  });

  it("does not mistake a conversation viewport resize for a user scroll", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget();

    controller.handleConversationChange(scrollTarget);
    scrollTarget.scrollTo.mockClear();

    // Task 切换后 Composer 完成布局可能压缩聊天区域，此时旧 scrollTop 会暂时离开底部。
    scrollTarget.clientHeight = 280;
    controller.handleScroll(scrollTarget);

    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
    expect(scrollTarget.scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1_000 });
  });

  it("keeps following until the switched conversation finishes rendering", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget();

    controller.handleConversationChange(scrollTarget);
    scrollTarget.scrollTo.mockClear();

    // 长 Task 分帧渲染时，浏览器可能在最终布局前报告一个位于中部的临时位置。
    scrollTarget.scrollTop = 300;
    controller.handleScroll(scrollTarget);

    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
    expect(scrollTarget.scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", top: 1_000 });

    controller.handleConversationRenderComplete(scrollTarget);
    scrollTarget.scrollTo.mockClear();
    scrollTarget.scrollTop = 300;
    controller.handleScroll(scrollTarget);

    expect(onAtBottomChange).toHaveBeenLastCalledWith(false);
    expect(scrollTarget.scrollTo).not.toHaveBeenCalled();
  });

  it("pauses after the user scrolls away and resumes after they return to the bottom", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget({ scrollTop: 300 });

    controller.handleScroll(scrollTarget);
    scrollTarget.scrollHeight = 1_200;
    controller.handleContentResize(scrollTarget);

    expect(onAtBottomChange).toHaveBeenLastCalledWith(false);
    expect(scrollTarget.scrollTo).not.toHaveBeenCalled();

    scrollTarget.scrollTop = 780;
    controller.handleScroll(scrollTarget);
    controller.handleContentResize(scrollTarget);

    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
    expect(scrollTarget.scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1_200 });
  });

  it("resumes following when explicitly scrolling back to the bottom", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget({ scrollTop: 200 });

    controller.handleScroll(scrollTarget);
    controller.scrollToBottom(scrollTarget);

    expect(scrollTarget.scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 1_000 });
    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
  });

  it("pauses following before navigating to virtualized history", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget();

    controller.pauseFollowing();
    scrollTarget.scrollHeight = 1_800;
    controller.handleContentResize(scrollTarget);

    expect(scrollTarget.scrollTo).not.toHaveBeenCalled();
    expect(onAtBottomChange).toHaveBeenLastCalledWith(false);
  });

  it("resets to the bottom when the active conversation changes", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget({ scrollTop: 200 });

    controller.handleScroll(scrollTarget);
    scrollTarget.scrollHeight = 2_000;

    // 切换会话是新的阅读边界，不能继承上一个会话暂停跟随后的滚动位置。
    controller.handleConversationChange(scrollTarget);

    expect(scrollTarget.scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 2_000 });
    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);

    scrollTarget.scrollHeight = 2_400;
    controller.handleContentResize(scrollTarget);
    expect(scrollTarget.scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", top: 2_400 });
  });
});
