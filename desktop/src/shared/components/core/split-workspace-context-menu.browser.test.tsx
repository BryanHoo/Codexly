import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { DocumentWorkspace } from "@codexly/ui/core/document-workspace";
import { useDocumentWorkspace } from "@codexly/ui/core/use-document-workspace";
import { SplitWorkspaceGrid, SplitWorkspaceProvider } from "@codexly/ui/core/split-workspace";
import "@codexly/ui/core/split-workspace.css";
import "@codexly/ui/core/document-workspace.css";

describe("中栏右键菜单范围", () => {
  it.each([false, true])(
    "非聊天标签保留原生右键，对照时仅聊天打开分屏菜单（desktop=%s）",
    async (desktop) => {
      let state: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
      function View() {
        const workspace = useDocumentWorkspace<{ id: string }>(`context-menu-${String(desktop)}`);
        useLayoutEffect(() => {
          state = workspace;
        }, [workspace]);
        return (
          <div style={{ display: "grid", width: 900, height: 500 }}>
            <SplitWorkspaceGrid
              label="工作区"
              sidebarOpen
              toggleSidebar={() => undefined}
              splitLabels={{
                up: "向上分屏",
                down: "向下分屏",
                left: "向左分屏",
                right: "向右分屏",
                limit: "上限",
              }}
            >
              {() => (
                <DocumentWorkspace
                  workspace={workspace}
                  locale="zh-CN"
                  describe={(doc) => ({ title: doc.id, detail: doc.id, kind: "source" })}
                  renderDocument={() => (
                    <div data-file-content="" style={{ height: "100%" }}>
                      <img
                        alt="预览图片"
                        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
                      />
                    </div>
                  )}
                >
                  <div data-chat-content="" style={{ height: "100%" }} />
                </DocumentWorkspace>
              )}
            </SplitWorkspaceGrid>
          </div>
        );
      }
      const screen = await render(
        <SplitWorkspaceProvider
          current={{ projectId: "project", taskId: "task" }}
          routeKey="menu"
          desktop={desktop}
        >
          <View />
        </SplitWorkspaceProvider>,
      );
      const host = screen.getByLabelText("工作区", { exact: true }).element();
      const rightClick = (target: Element) => {
        const bounds = target.getBoundingClientRect();
        const point = {
          clientX: bounds.left + 2,
          clientY: bounds.top + 2,
          button: 2,
          bubbles: true,
          cancelable: true,
        };
        // 分开提交按压与右键事件，模拟真实指针顺序，让 Trigger 使用最新命中状态。
        flushSync(() =>
          target.dispatchEvent(new PointerEvent("pointerdown", { ...point, pointerType: "mouse" })),
        );
        const event = new MouseEvent("contextmenu", point);
        flushSync(() => target.dispatchEvent(event));
        return event.defaultPrevented;
      };
      // 先启用聊天菜单，再切到文件，覆盖上一轮 blank 状态残留的情况。
      expect(rightClick(host.querySelector("[data-chat-content]")!)).toBe(true);
      await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
      for (const id of ["image.png", "document.pdf", "source.ts", "changes.diff"]) {
        flushSync(() => {
          void state!.open({ id });
        });
        expect(rightClick(host.querySelector("[data-file-content]")!)).toBe(false);
        expect(rightClick(host.querySelector("img")!)).toBe(false);
        expect(document.querySelector('[role="menu"]')).toBeNull();
      }
      flushSync(() => {
        void state!.compare("right");
      });
      expect(rightClick(host.querySelector("[data-file-content]")!)).toBe(false);
      expect(rightClick(host.querySelector("[data-chat-content]")!)).toBe(true);
      await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
      await userEvent.keyboard("{Escape}");
    },
  );
});
