import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ConversationList } from "./conversation.js";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function nextFrames(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) await nextFrame();
}

async function settleVirtualScroll(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 180));
  await nextFrames();
}

describe("Conversation visual anchor", () => {
  it("从短任务切换到长任务且视口收缩后保持最新位置置底", async () => {
    let showLongTask = () => undefined;
    let showShortTask = () => undefined;
    function TaskSwitchHarness() {
      const [longTaskVisible, setLongTaskVisible] = useState(false);
      const items = longTaskVisible
        ? Array.from({ length: 207 }, (_, index) => `long-turn-${String(index)}`)
        : ["short-turn-0"];
      useEffect(() => {
        showLongTask = () => {
          setLongTaskVisible(true);
        };
        showShortTask = () => {
          setLongTaskVisible(false);
        };
        return () => {
          showLongTask = () => undefined;
          showShortTask = () => undefined;
        };
      }, []);
      return (
        <ConversationList
          conversationId={longTaskVisible ? "task-long" : "task-short"}
          getItemKey={(turnId) => turnId}
          items={items}
          key={longTaskVisible ? "task-long" : "task-short"}
          renderItem={(turnId, index) => (
            <div style={{ height: longTaskVisible ? 80 + (index % 7) * 180 : 80 }}>{turnId}</div>
          )}
          style={{ height: 320, overflowY: "auto" }}
        />
      );
    }
    const screen = await render(<TaskSwitchHarness />);
    let container = screen.getByRole("log").element();
    await settleVirtualScroll();

    expect(getComputedStyle(container).overflowAnchor).toBe("none");
    showLongTask();
    await settleVirtualScroll();
    container = screen.getByRole("log").element();
    container.style.height = "240px";
    await settleVirtualScroll();

    expect(container.textContent).toContain("long-turn-206");
    expect(container.scrollHeight - container.scrollTop - container.clientHeight).toBeLessThan(1);

    showShortTask();
    await settleVirtualScroll();
    showLongTask();
    await settleVirtualScroll();
    container = screen.getByRole("log").element();

    expect(container.textContent).toContain("long-turn-206");
    expect(container.scrollHeight - container.scrollTop - container.clientHeight).toBeLessThan(1);
  });

  it("仅挂载视口窗口并使用 WebKit 安全的位置直写模式", async () => {
    const items = Array.from({ length: 207 }, (_, index) => `turn-${String(index)}`);
    const screen = await render(
      <ConversationList
        conversationId="task-virtual-window"
        getItemKey={(turnId) => turnId}
        items={items}
        renderItem={(turnId) => <div style={{ height: 120 }}>{turnId}</div>}
        style={{ height: 320, overflowY: "auto" }}
      />,
    );

    await nextFrame();
    await nextFrame();
    const container = screen.getByRole("log").element();
    const turns = container.querySelectorAll<HTMLElement>("[data-conversation-turn]");

    expect(turns.length).toBeGreaterThan(0);
    expect(turns.length).toBeLessThan(20);
    expect(container.textContent).toContain("turn-206");
    for (const turn of turns) {
      expect(turn.style.position).toBe("absolute");
      expect(turn.style.top).not.toBe("");
      expect(turn.style.transform).toBe("");
    }
  });

  it("视口上方的 Turn 恢复真实高度后保持当前 Turn 位置", async () => {
    const items = Array.from({ length: 20 }, (_, index) => `turn-${String(index)}`);
    const screen = await render(
      <ConversationList
        conversationId="task-with-long-history"
        getItemKey={(turnId) => turnId}
        items={items}
        renderItem={(turnId) => <div style={{ height: 240 }}>{turnId}</div>}
        style={{ height: 320, overflowAnchor: "none", overflowY: "auto" }}
      />,
    );
    const container = screen.getByRole("log").element();

    // 先完成任务切换置底，再模拟用户在历史中段阅读。
    await settleVirtualScroll();
    container.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }));
    container.scrollTop = Math.floor((container.scrollHeight - container.clientHeight) / 2);
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await settleVirtualScroll();
    const containerTop = container.getBoundingClientRect().top;
    const turns = Array.from(
      container.querySelectorAll<HTMLElement>("[data-conversation-turn]"),
    );
    const anchor = turns.find((turn) => turn.getBoundingClientRect().top >= containerTop);
    const source = turns.find((turn) => turn.getBoundingClientRect().bottom <= containerTop);

    expect(anchor).toBeDefined();
    expect(source).toBeDefined();
    if (anchor === undefined || source === undefined) return;
    const anchorTop = anchor.getBoundingClientRect().top;

    source.style.height = "1140px";
    await nextFrame();
    await nextFrame();

    expect(Math.abs(anchor.getBoundingClientRect().top - anchorTop)).toBeLessThan(1);
  });

  it("仅在已经置底时跟随追加 Turn", async () => {
    let appendTurn = () => undefined;
    function AppendHarness() {
      const [items, setItems] = useState(() =>
        Array.from({ length: 20 }, (_, index) => `turn-${String(index)}`),
      );
      useEffect(() => {
        appendTurn = () => {
          setItems((current) => [...current, `turn-${String(current.length)}`]);
        };
        return () => {
          appendTurn = () => undefined;
        };
      }, []);
      return (
        <ConversationList
          conversationId="task-append"
          footer={<div style={{ height: 40 }}>pending</div>}
          getItemKey={(turnId) => turnId}
          items={items}
          renderItem={(turnId) => <div style={{ height: 120 }}>{turnId}</div>}
          style={{ height: 320, overflowY: "auto" }}
        />
      );
    }
    const screen = await render(<AppendHarness />);
    const container = screen.getByRole("log").element();
    await nextFrames();

    appendTurn();
    await settleVirtualScroll();
    expect(container.scrollHeight - container.scrollTop - container.clientHeight).toBeLessThan(1);

    container.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -240 }));
    container.scrollTop -= 240;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await settleVirtualScroll();
    const readingPosition = container.scrollTop;
    appendTurn();
    await settleVirtualScroll();

    expect(Math.abs(container.scrollTop - readingPosition)).toBeLessThan(1);
  });

  it("最后一个 Turn 流式增长时保持置底", async () => {
    let growLastTurn = () => undefined;
    function StreamingHarness() {
      const [lastTurnHeight, setLastTurnHeight] = useState(120);
      const items = Array.from({ length: 20 }, (_, index) => `turn-${String(index)}`);
      useEffect(() => {
        growLastTurn = () => {
          setLastTurnHeight((current) => current + 640);
        };
        return () => {
          growLastTurn = () => undefined;
        };
      }, []);
      return (
        <ConversationList
          conversationId="task-streaming"
          getItemKey={(turnId) => turnId}
          items={items}
          renderItem={(turnId, index) => (
            <div style={{ height: index === items.length - 1 ? lastTurnHeight : 120 }}>{turnId}</div>
          )}
          style={{ height: 320, overflowY: "auto" }}
        />
      );
    }
    const screen = await render(<StreamingHarness />);
    const container = screen.getByRole("log").element();
    await settleVirtualScroll();

    growLastTurn();
    await settleVirtualScroll();

    expect(container.scrollHeight - container.scrollTop - container.clientHeight).toBeLessThan(1);
  });

  it("prepend 更早历史后保持当前可见 Turn", async () => {
    let prependHistory = () => undefined;
    function PrependHarness() {
      const [items, setItems] = useState(() =>
        Array.from({ length: 50 }, (_, index) => `turn-${String(index + 50)}`),
      );
      useEffect(() => {
        prependHistory = () => {
          setItems((current) => [
            ...Array.from({ length: 50 }, (_, index) => `turn-${String(index)}`),
            ...current,
          ]);
        };
        return () => {
          prependHistory = () => undefined;
        };
      }, []);
      return (
        <ConversationList
          conversationId="task-prepend"
          getItemKey={(turnId) => turnId}
          header={<div style={{ height: 40 }}>load older</div>}
          items={items}
          renderItem={(turnId) => <div style={{ height: 80 }}>{turnId}</div>}
          style={{ height: 320, overflowY: "auto" }}
        />
      );
    }
    const screen = await render(<PrependHarness />);
    const container = screen.getByRole("log").element();
    await settleVirtualScroll();
    container.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }));
    container.scrollTop = Math.floor((container.scrollHeight - container.clientHeight) / 2);
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await settleVirtualScroll();

    const scrollTopBeforePrepend = container.scrollTop;
    const scrollHeightBeforePrepend = container.scrollHeight;

    prependHistory();
    await settleVirtualScroll();
    await expect
      .poll(
        () =>
          Math.abs(
            (container.scrollTop - scrollTopBeforePrepend) -
              (container.scrollHeight - scrollHeightBeforePrepend),
          ),
        { timeout: 5_000 },
      )
      .toBeLessThan(1);
  });

  it("向上滚动后允许用户离开底部", async () => {
    const screen = await render(
      <ConversationList
        conversationId="task-user-scroll"
        getItemKey={(turnId) => turnId}
        items={["turn-0"]}
        renderItem={(turnId) => <div style={{ height: 1_600 }}>{turnId}</div>}
        style={{ height: 320, overflowY: "auto" }}
      />,
    );
    const container = screen.getByRole("log").element();

    await settleVirtualScroll();
    container.scrollTop = container.scrollHeight - container.clientHeight;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    container.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }));
    container.scrollTop -= 120;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextFrame();
    const readingPosition = container.scrollTop;

    container.style.height = "240px";
    await settleVirtualScroll();

    expect(container.scrollTop).toBeLessThan(container.scrollHeight - container.clientHeight);
    expect(Math.abs(container.scrollTop - readingPosition)).toBeLessThan(1);
  });
});
