import "../../styles/globals.css";
import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { ConversationList } from "@codexly/ui/agent/conversation";
import { DocumentWorkspace } from "@codexly/ui/core/document-workspace";
import { useDocumentWorkspace } from "@codexly/ui/core/use-document-workspace";
import "@codexly/ui/core/document-workspace.css";

async function frames() {
  for (let index = 0; index < 4; index++)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe("聊天标签阅读位置", () => {
  it.each([360, 900])(
    "聊天隐藏后保留历史阅读位置及底部跟随，主动提交仍定位新消息（宽度=%s）",
    async (width) => {
      let workspace: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
      let append!: () => void;
      let submit!: () => void;
      function View() {
        const state = useDocumentWorkspace<{ id: string }>("chat-scroll");
        const [items, setItems] = useState(Array.from({ length: 20 }, (_, index) => index));
        const [signal, setSignal] = useState(0);
        useLayoutEffect(() => {
          workspace = state;
          append = () => setItems((previous) => [...previous, previous.length]);
          submit = () => {
            append();
            setSignal((previous) => previous + 1);
          };
        });
        return (
          <div style={{ width, height: 500, display: "flex" }}>
            <DocumentWorkspace
              workspace={state}
              locale="zh-CN"
              describe={(doc) => ({ title: doc.id, detail: doc.id, kind: "source" })}
              renderDocument={() => <div>文件预览</div>}
            >
              <ConversationList
                conversationId="chat"
                scrollToBottomSignal={signal}
                scrollLabel="回到底部"
                items={items}
                getItemKey={(id) => id}
                renderItem={(id) => (
                  <div data-answer={id} style={{ height: 200 }}>
                    回复 {id}
                  </div>
                )}
              />
            </DocumentWorkspace>
          </div>
        );
      }
      const screen = await render(<View />);
      const viewport = document.querySelector<HTMLElement>(
        '[data-slot="message-scroller-viewport"]',
      )!;
      const atBottom = () => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      await expect.poll(atBottom).toBeLessThan(2);
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, bubbles: true }));
      viewport.scrollTop = 500;
      await frames();
      const answer = viewport.querySelector<HTMLElement>('[data-answer="2"]')!;
      const offset = () =>
        answer.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      const original = offset();
      // 普通切换与隐藏期间继续接收消息均不能重置用户阅读锚点。
      for (const grow of [false, true, true]) {
        flushSync(() => {
          void workspace.open({ id: "a.md" });
        });
        if (grow) flushSync(append);
        await frames();
        flushSync(() => {
          void workspace.select(null);
        });
        await frames();
        expect(Math.abs(offset() - original)).toBeLessThan(2);
      }
      await screen.getByRole("button", { name: "回到底部", exact: true }).click();
      await expect.poll(atBottom).toBeLessThan(2);
      flushSync(() => {
        void workspace.select("a.md");
      });
      flushSync(append);
      await frames();
      flushSync(() => {
        void workspace.select(null);
      });
      await expect.poll(atBottom).toBeLessThan(2);
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, bubbles: true }));
      viewport.scrollTop = 500;
      await frames();
      flushSync(submit);
      await expect.poll(atBottom).toBeLessThan(2);
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, bubbles: true }));
      viewport.scrollTop = 500;
      await frames();
      flushSync(() => {
        void workspace.select("a.md");
      });
      flushSync(submit);
      await frames();
      flushSync(() => {
        void workspace.select(null);
      });
      await expect.poll(atBottom).toBeLessThan(2);
    },
  );
});
