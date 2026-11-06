import "../../src/shared/styles/globals.css";
import { Activity, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { ConversationList } from "@codexly/ui/agent/conversation";
import { FileDiffCard } from "@codexly/ui/agent/file-diff-card";

async function frames() {
  for (let index = 0; index < 4; index++)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

it.each(
  [360, 900].flatMap((width) => ["wheel", "touchmove", "keydown"].map((type) => ({ width, type }))),
)("$width px diff 内部 $type 不应暂停外层跟随，隐藏期间追加后仍跟随", async ({ width, type }) => {
  let append!: () => void;
  let hide!: (value: boolean) => void;
  function View() {
    const [count, setCount] = useState(0);
    const [hidden, setHidden] = useState(false);
    useLayoutEffect(() => {
      append = () => setCount((value) => value + 1);
      hide = setHidden;
    }, []);
    return (
      <Activity mode={hidden ? "hidden" : "visible"}>
        <div style={{ height: 500, width }}>
          <ConversationList
            conversationId="diff"
            scrollLabel="回到底部"
            items={[1]}
            getItemKey={(id) => id}
            renderItem={() => (
              <>
                <div style={{ height: 700 }} />
                <FileDiffCard
                  path="test.ts"
                  additions={100}
                  removals={1}
                  status="running"
                  statusLabel="运行中"
                  openLabel="打开差异"
                  onOpen={() => undefined}
                >
                  <div data-diff-lines style={{ height: 1200 }}>
                    补丁正文
                  </div>
                </FileDiffCard>
                <div style={{ height: count * 100 }}>最新输出 {count}</div>
              </>
            )}
          />
        </div>
      </Activity>
    );
  }
  await render(<View />);
  const viewport = document.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!;
  const gap = () => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  await expect.poll(gap).toBeLessThan(2);
  const host = document.querySelector<HTMLElement>("[data-diff-lines]")!;
  // 真实补丁使用 Shadow DOM；事件路径必须能穿过影子边界识别内部阅读区域。
  const shadow = host.attachShadow({ mode: "open" });
  const lines = document.createElement("span");
  lines.textContent = "补丁行";
  shadow.append(lines);
  // 不依赖浏览器是否实际滚动；内部阅读意图本身不能切换外层跟随状态。
  lines.dispatchEvent(
    type === "wheel"
      ? new WheelEvent(type, { deltaY: -100, bubbles: true, composed: true })
      : type === "keydown"
        ? new KeyboardEvent(type, { key: "ArrowUp", bubbles: true, composed: true })
        : new Event(type, { bubbles: true, composed: true }),
  );
  // 同步追加复现原生 scroll 事件尚未送达前的布局竞争。
  flushSync(append);
  await frames();
  expect(gap()).toBeLessThan(2);
  flushSync(() => hide(true));
  flushSync(append);
  await frames();
  flushSync(() => hide(false));
  await expect.poll(gap).toBeLessThan(2);
  // 外层主动上滚仍应暂停；内部隔离不能把会话变成始终强制置底。
  viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -300, bubbles: true }));
  viewport.scrollTop -= 300;
  await frames();
  const readingTop = viewport.scrollTop;
  flushSync(append);
  await frames();
  expect(viewport.scrollTop).toBeCloseTo(readingTop, 0);
});

it.each(["focus", "visibilitychange"])(
  "%s 恢复时维持跟随位置，同时保留主动上滚的阅读位置",
  async (type) => {
    await render(
      <div style={{ height: 500, width: 900 }}>
        <ConversationList
          conversationId="resume"
          scrollLabel="回到底部"
          items={[1]}
          getItemKey={(id) => id}
          renderItem={() => <div style={{ height: 1600 }} />}
        />
      </div>,
    );
    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="message-scroller-viewport"]',
    )!;
    const gap = () => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    await expect.poll(gap).toBeLessThan(2);
    // 模拟后台 WebView 恢复了旧 scrollTop，但没有新的尺寸或 DOM 变更。
    viewport.scrollTop -= 150;
    await frames();
    const resume = () => (type === "focus" ? window : document).dispatchEvent(new Event(type));
    resume();
    await expect.poll(gap).toBeLessThan(2);
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -300, bubbles: true }));
    viewport.scrollTop -= 300;
    await frames();
    const readingTop = viewport.scrollTop;
    resume();
    await frames();
    expect(viewport.scrollTop).toBeCloseTo(readingTop, 0);
  },
);
