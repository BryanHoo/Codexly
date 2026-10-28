import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ConversationList } from "./conversation.js";
import "../../styles/globals.css";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

it("尾部在测量交付后更新时不被上一帧尺寸回滚", async () => {
  const NativeResizeObserver = globalThis.ResizeObserver;
  const deliveries: (() => void)[] = [];
  let holdMeasurements = false;
  let captured = false;
  const observerMock = vi.spyOn(globalThis, "ResizeObserver").mockImplementation(function (callback) {
    return new NativeResizeObserver((entries, observer) => {
      if (!holdMeasurements) return callback(entries, observer);
      deliveries.push(() => callback(entries, observer));
      if (entries.some((entry) => (entry.target as HTMLElement).dataset["slot"] === "message-scroller-content")) {
        captured = true;
      }
    });
  });
  const history = Array.from({ length: 20 }, (_, index) => `turn-${index}`);
  let updateFooter = (_height: number) => {};
  function Harness() {
    const [height, setHeight] = useState(32);
    useEffect(() => {
      updateFooter = setHeight;
      return () => { updateFooter = () => {}; };
    }, []);
    return <ConversationList
      conversationId="footer-measurement-race"
      footer={<div style={{ height }}>pending</div>}
      getItemKey={(item) => item}
      items={history}
      renderItem={(item) => <div style={{ height: 120 }}>{item}</div>}
      style={{ height: 480, overflowY: "auto" }}
    />;
  }
  const screen = await render(<Harness />);
  await expect.element(screen.getByRole("region")).toBeInTheDocument();
  const container = screen.getByRole("region").element();
  await expect.element(screen.getByText("pending", { exact: true })).toBeVisible();
  await expect.poll(() => container.scrollHeight - container.scrollTop - container.clientHeight).toBeLessThan(1);
  const footer = container.querySelector<HTMLElement>('[data-conversation-row="footer"]')!;
  try {
    for (let index = 0; index < 3; index += 1) await nextFrame();
    holdMeasurements = true;
    flushSync(() => updateFooter(64));
    await expect.poll(() => captured).toBe(true);
    // 保留真实旧测量，模拟提交响应先更新布局、测量回调随后才消费旧 entry。
    flushSync(() => updateFooter(248));
    holdMeasurements = false;
    for (const deliver of deliveries) deliver();
    for (let index = 0; index < 8; index += 1) {
      await nextFrame();
      expect.soft(container.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom).toBe(container.clientHeight / 4);
      expect.soft(container.scrollHeight - container.scrollTop - container.clientHeight).toBeLessThan(1);
    }
  } finally {
    observerMock.mockRestore();
  }
});

it("仅尾部占位变化时在布局观察后保持真实高度与置底", async () => {
  const history = Array.from({ length: 20 }, (_, index) => `turn-${index}`);
  let updateFooter = (_height: number | undefined) => {};
  function Harness() {
    const [footerHeight, setFooterHeight] = useState<number | undefined>(64);
    useEffect(() => {
      updateFooter = setFooterHeight;
      return () => { updateFooter = () => {}; };
    }, []);
    return <ConversationList
      conversationId="footer-resize"
      footer={footerHeight === undefined ? undefined : <div style={{ height: footerHeight }}>pending</div>}
      getItemKey={(item) => item}
      items={history}
      renderItem={(item) => <div style={{ height: 120 }}>{item}</div>}
      style={{ height: 480, overflowY: "auto" }}
    />;
  }
  const screen = await render(<Harness />);
  await expect.element(screen.getByRole("region")).toBeInTheDocument();
  const container = screen.getByRole("region").element();
  await expect.poll(() => container.scrollHeight - container.scrollTop - container.clientHeight).toBeLessThan(1);
  await expect.poll(() => {
    const footer = container.querySelector<HTMLElement>('[data-conversation-row="footer"]');
    return footer ? container.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom : null;
  }).toBe(container.clientHeight / 4);
  for (const height of [160, undefined, 64]) {
    // 新底层通过 ResizeObserver 合并流式布局更新，保留帧级跟随而不逐 token 同步测量。
    flushSync(() => updateFooter(height));
    await nextFrame();
    await nextFrame();
    await nextFrame();
    await expect.poll(() => {
      const rows = container.querySelectorAll<HTMLElement>("[data-conversation-row]");
      const lastRow = rows[rows.length - 1]!;
      return container.getBoundingClientRect().bottom - lastRow.getBoundingClientRect().bottom;
    }, { timeout: 1000 }).toBe(container.clientHeight / 4);
    expect(container.scrollHeight - container.scrollTop - container.clientHeight).toBeLessThan(1);
  }
});

it("发送新消息时历史位置不反向跳动且待处理尾部保持挂载", async () => {
  const history = Array.from({ length: 20 }, (_, index) => `turn-${String(index)}`);
  let submit = () => {};
  let confirm = () => {};
  function Harness() {
    const [pending, setPending] = useState(false);
    const [items, setItems] = useState(history);
    useEffect(() => {
      submit = () => setPending(true);
      confirm = () => setItems([...history, "new-turn"]);
      return () => {
        submit = () => {};
        confirm = () => {};
      };
    }, []);
    return (
      <ConversationList
        conversationId="submission"
        footer={pending ? <div data-pending="" style={{ height: 64 }}>pending</div> : undefined}
        getItemKey={(item) => item}
        items={items}
        renderItem={(item) => <div style={{ height: 120 }}>{item}</div>}
        scrollToBottomSignal={pending ? 1 : 0}
        style={{ height: 480, overflowY: "auto" }}
      />
    );
  }
  const screen = await render(<Harness />);
  await expect.element(screen.getByRole("region")).toBeInTheDocument();
  const container = screen.getByRole("region").element();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const historyRow = Array.from(container.querySelectorAll<HTMLElement>('[data-conversation-row="turn"]'))
    .find((row) => row.textContent === "turn-19");
  expect(historyRow).toBeDefined();
  if (historyRow === undefined) return;

  // 记录每一帧的实际可见位置，不能只检查最终置底而漏掉中间回弹。
  const positions = [historyRow.getBoundingClientRect().top];
  submit();
  for (let index = 0; index < 12; index += 1) {
    await nextFrame();
    positions.push(historyRow.getBoundingClientRect().top);
  }
  const pending = container.querySelector("[data-pending]");
  expect(pending).not.toBeNull();
  confirm();
  for (let index = 0; index < 12; index += 1) {
    await nextFrame();
    positions.push(historyRow.getBoundingClientRect().top);
  }
  expect.soft(container.querySelector("[data-pending]")).toBe(pending);
  expect.soft(historyRow.isConnected).toBe(true);
  expect.soft(Math.max(...positions.slice(1).map((top, index) => top - positions[index]!))).toBeLessThan(1);
  expect(container.scrollHeight - container.scrollTop - container.clientHeight).toBeLessThan(1);
});
