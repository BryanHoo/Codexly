import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { measureSplitWorkspaceFocus } from "./split-workspace-focus.fixture";
import { splitPaneKey, type SplitPaneIdentity } from "@codexly/frontend-core/split-workspace";
import "@codexly/ui/core/split-workspace.css";
import {
  SplitWorkspaceGrid,
  SplitWorkspaceProvider,
  useSplitWorkspace,
} from "@codexly/ui/core/split-workspace";

const original = { projectId: "project", taskId: "original" };
const next = { projectId: "project", taskId: "next" };

function Controls() {
  const workspace = useSplitWorkspace()!;
  return (
    <>
      <button onClick={() => workspace.add(original)}>Add original</button>
      <button onClick={() => workspace.close(original)}>Close original</button>
    </>
  );
}

function View({ current }: { current: SplitPaneIdentity }) {
  return (
    <SplitWorkspaceProvider current={current} routeKey={JSON.stringify(current)} desktop>
      <Controls />
      <SplitWorkspaceGrid
        label="Workspace"
        sidebarOpen
        toggleSidebar={() => undefined}
        splitLabels={{ up: "Up", down: "Down", left: "Left", right: "Right", limit: "Limit" }}
      >
        {(pane) => <textarea aria-label={`Draft ${pane.taskId}`} />}
      </SplitWorkspaceGrid>
    </SplitWorkspaceProvider>
  );
}

describe("split workspace mount identity", () => {
  it.each([false, true])(
    "增删分屏后按实际尺寸等分且保留输入框与草稿（desktop=%s）",
    async (desktop) => {
      let workspace: NonNullable<ReturnType<typeof useSplitWorkspace>>;
      function LayoutView() {
        const value = useSplitWorkspace()!;
        useLayoutEffect(() => {
          workspace = value;
        }, [value]);
        return (
          <div style={{ display: "grid", width: 1200, height: 600 }}>
            <SplitWorkspaceGrid
              label="Adaptive workspace"
              sidebarOpen
              toggleSidebar={() => undefined}
              splitLabels={{ up: "Up", down: "Down", left: "Left", right: "Right", limit: "Limit" }}
            >
              {(pane) => <textarea aria-label={splitPaneKey(pane)} />}
            </SplitWorkspaceGrid>
          </div>
        );
      }
      const screen = await render(
        <SplitWorkspaceProvider current={original} routeKey="adaptive" desktop={desktop}>
          <LayoutView />
        </SplitWorkspaceProvider>,
      );
      const editor = screen.getByRole("textbox", { name: splitPaneKey(original) }).element();
      await screen.getByRole("textbox", { name: splitPaneKey(original) }).fill("保留未发送草稿");
      // 使用真实布局框验证比例，覆盖像素取整；同时确认重排只移动原有 DOM。
      const assertLayout = (count: number) => {
        const container = screen.getByLabelText("Adaptive workspace", { exact: true }).element();
        const bounds = container.getBoundingClientRect();
        const panes = [...container.querySelectorAll(".split-workspace-pane")];
        expect(panes).toHaveLength(count);
        const rects = panes.map((pane) => pane.getBoundingClientRect());
        rects.forEach((rect) => {
          expect(Math.abs(rect.width - bounds.width / (count === 4 ? 2 : count))).toBeLessThan(2);
          expect(Math.abs(rect.height - bounds.height / (count === 4 ? 2 : 1))).toBeLessThan(2);
        });
        expect(new Set(rects.map((rect) => Math.round(rect.left))).size).toBe(
          count === 4 ? 2 : count,
        );
        expect(new Set(rects.map((rect) => Math.round(rect.top))).size).toBe(count === 4 ? 2 : 1);
        expect(screen.getByRole("textbox", { name: splitPaneKey(original) }).element()).toBe(
          editor,
        );
        expect((editor as HTMLTextAreaElement).value).toBe("保留未发送草稿");
      };
      flushSync(() => workspace!.split(original, "right"));
      assertLayout(2);
      flushSync(() => workspace!.split(original, "right"));
      assertLayout(3);
      flushSync(() => workspace!.split(original, "right"));
      assertLayout(4);
      flushSync(() => workspace!.resize("", 0.7));
      flushSync(() => workspace!.close(workspace!.panes[1]!));
      assertLayout(3);
      flushSync(() => workspace!.close(workspace!.panes[1]!));
      assertLayout(2);
    },
  );

  it.each([false, true])("切换焦点只更新原活动窗口和新活动窗口（desktop=%s）", (desktop) => {
    const result = measureSplitWorkspaceFocus(desktop);
    expect(result.focusRenders).toEqual([12, 12, 0, 0]);
    expect(result.resizeRenders).toEqual([0, 0, 0, 0]);
    expect(result.repeatedFocusRenders).toEqual([0, 0, 0, 0]);
    expect(result.focusStateRenders).toBe(0);
    expect(result.actionRenders).toBe(1);
    expect(result.stableActions).toBe(true);
    expect(result.selectedLatestPane).toBe(true);
    expect(result.singlePaneFallback).toBe(true);
    expect(result.mounts).toEqual([1, 1, 1, 1]);
    expect(result.sameEditors).toBe(true);
    expect(result.draft).toBe("保留未发送草稿");
  });
  it("keeps the input mounted across single-task routes and when adding or closing neighbors", async () => {
    const screen = await render(<View current={original} />);
    const editor = screen.getByRole("textbox", { name: "Draft original" }).element();
    await screen.rerender(<View current={next} />);
    expect(screen.getByRole("textbox", { name: "Draft next" }).element()).toBe(editor);
    await screen.getByRole("textbox", { name: "Draft next" }).fill("Unsent draft");
    await screen.getByRole("button", { name: "Add original" }).click();
    expect(screen.getByRole("textbox", { name: "Draft next" }).element()).toBe(editor);
    await expect
      .element(screen.getByRole("textbox", { name: "Draft next" }))
      .toHaveValue("Unsent draft");
    expect(screen.getByRole("textbox", { name: "Draft original" }).element()).not.toBe(editor);
    await screen.getByRole("button", { name: "Close original" }).click();
    expect(screen.getByRole("textbox", { name: "Draft next" }).element()).toBe(editor);
    await expect
      .element(screen.getByRole("textbox", { name: "Draft next" }))
      .toHaveValue("Unsent draft");
  });
});
