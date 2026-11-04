import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DocumentWorkspace } from "@codexly/ui/core/document-workspace";
import { useDocumentWorkspace } from "@codexly/ui/core/use-document-workspace";
import "@codexly/ui/core/document-workspace.css";
import { CodeBlockContent } from "../../../../../packages/ui/src/agent/code-block-content.js";

describe("文件标签阅读位置", () => {
  it("只读源码返回标签后保留阅读位置，不被原始行号定位覆盖", async () => {
    let workspace: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
    const pages = [{ key: "source", code: "源码\n".repeat(300) }];
    function View() {
      const state = useDocumentWorkspace<{ id: string }>("source-scroll");
      useLayoutEffect(() => {
        workspace = state;
      });
      return (
        <div style={{ width: 500, height: 260, display: "flex" }}>
          <DocumentWorkspace
            workspace={state}
            locale="zh-CN"
            describe={(doc) => ({ title: doc.id, detail: doc.id, kind: "source" })}
            renderDocument={() => (
              <CodeBlockContent
                data-source-scroll=""
                pages={pages}
                language="text"
                highlightedLine={3}
                tokenizeCode={async () => {
                  throw new Error("纯文本不需要高亮");
                }}
                style={{ overflow: "auto", height: 180, width: 300 }}
              />
            )}
          >
            <textarea />
          </DocumentWorkspace>
        </div>
      );
    }
    await render(<View />);
    flushSync(() => {
      void workspace.open({ id: "source.txt" });
    });
    const scroll = () => document.querySelector<HTMLElement>("[data-source-scroll]")!;
    scroll().scrollTop = 1500;
    scroll().dispatchEvent(new Event("scroll"));
    flushSync(() => {
      void workspace.select(null);
    });
    flushSync(() => {
      void workspace.select("source.txt");
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(scroll().scrollTop).toBe(1500);
  });
  it("切到聊天或另一文件后恢复横纵滚动，异步内容就绪后恢复且关闭后释放", async () => {
    let workspace: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
    let load!: () => void;
    let delayed = false;
    let short = false;
    function File() {
      const [ready, setReady] = useState(!delayed);
      const [height, setHeight] = useState(short ? 200 : 4000);
      useLayoutEffect(() => {
        load = () => {
          setReady(true);
          setHeight(4000);
        };
      }, []);
      return ready ? (
        <div data-scroll="" style={{ overflow: "auto", height: 180, width: 300 }}>
          <div style={{ width: 1200, height }}>文件正文</div>
        </div>
      ) : (
        <div>加载中</div>
      );
    }
    function View({ scope = "project" }: { scope?: string }) {
      const state = useDocumentWorkspace<{ id: string }>(scope);
      useLayoutEffect(() => {
        workspace = state;
      });
      return (
        <div style={{ width: 500, height: 260, display: "flex" }}>
          <DocumentWorkspace
            workspace={state}
            locale="zh-CN"
            describe={(doc) => ({ title: doc.id, detail: doc.id, kind: "source" })}
            renderDocument={() => <File />}
          >
            <textarea />
          </DocumentWorkspace>
        </div>
      );
    }
    const screen = await render(<View />);
    const scroll = () => document.querySelector<HTMLElement>("[data-scroll]")!;
    const select = (id: string | null) =>
      flushSync(() => {
        void workspace.select(id);
      });
    const open = (id: string) =>
      flushSync(() => {
        void workspace.open({ id });
      });
    const move = (top: number, left: number) => {
      scroll().scrollTop = top;
      scroll().scrollLeft = left;
      scroll().dispatchEvent(new Event("scroll"));
    };
    open("a.md");
    move(1250, 120);
    select(null);
    expect(scroll()).toBeNull();
    select("a.md");
    await expect.poll(() => scroll().scrollTop).toBe(1250);
    expect(scroll().scrollLeft).toBe(120);
    open("b.md");
    expect(scroll().scrollTop).toBe(0);
    move(600, 40);
    select("a.md");
    await expect.poll(() => scroll().scrollTop).toBe(1250);
    select("b.md");
    await expect.poll(() => scroll().scrollTop).toBe(600);
    select(null);
    delayed = true;
    select("a.md");
    expect(scroll()).toBeNull();
    flushSync(() => load());
    await expect.poll(() => scroll().scrollTop).toBe(1250);
    expect(scroll().scrollLeft).toBe(120);
    delayed = false;
    select(null);
    short = true;
    select("a.md");
    flushSync(() => load());
    await expect.poll(() => scroll().scrollTop).toBe(1250);
    select(null);
    select("a.md");
    scroll().dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    move(10, 0);
    flushSync(() => load());
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(scroll().scrollTop).toBe(10);
    short = false;
    flushSync(() => {
      void workspace.close("a.md");
    });
    open("a.md");
    expect(scroll().scrollTop).toBe(0);
    move(700, 20);
    await screen.rerender(<View scope="other-project" />);
    open("a.md");
    expect(scroll().scrollTop).toBe(0);
  });
});
