import { ConversationList } from "@codexly/ui/agent/conversation";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import budgets from "../../../../../tests/performance-budgets.json";

it("千回合正文不因页脚或发送信号更新重复构造，保留全部 DOM 与选择", async () => {
  const items = Array.from(
    { length: budgets.activeConversation.singlePaneTurns },
    (_, index) => `turn-${String(index)}`,
  );
  const getItemKey = (item: string) => item;
  const renderItem = vi.fn((item: string) => <p>{item}</p>);
  const observe = vi.spyOn(ResizeObserver.prototype, "observe");
  const view = (signal: number) => (
    <div style={{ height: 600, width: 800 }}>
      <ConversationList
        conversationId="capacity"
        scrollLabel="返回最新"
        scrollToBottomSignal={signal}
        items={items}
        getItemKey={getItemKey}
        renderItem={renderItem}
        renderNavigation={() => <span>导航</span>}
        footer={<p>页脚 {signal}</p>}
      />
    </div>
  );
  const screen = await render(view(0));
  const rows = screen.container.querySelectorAll('[data-conversation-row="turn"]');
  expect(rows).toHaveLength(items.length);
  const first = rows[0]!;
  const viewport = screen.container.querySelector('[data-slot="message-scroller-viewport"]');
  expect(renderItem).toHaveBeenCalledTimes(items.length);
  renderItem.mockClear();
  observe.mockClear();

  await screen.rerender(view(1));
  await expect.element(screen.getByText("页脚 1")).toBeInTheDocument();
  expect(renderItem.mock.calls.length).toBe(0);
  expect(observe.mock.calls.filter(([node]) => node === viewport)).toHaveLength(0);
  expect(screen.container.querySelector('[data-conversation-row="turn"]')).toBe(first);
  // 使用真实 Range 验证屏外正文仍可选择；不能以卸载旧回合换取渲染计数下降。
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(first);
  selection.removeAllRanges();
  selection.addRange(range);
  expect(selection.toString().trim()).toBe(items[0]);
  selection.removeAllRanges();
});
