import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { measureSplitWorkspaceFocus } from "./split-workspace-focus.fixture";
import type { SplitPaneIdentity } from "@codexly/frontend-core/split-workspace";
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
