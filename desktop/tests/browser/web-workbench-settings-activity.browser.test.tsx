import { SettingsDialog } from "@codexly/ui/core/settings-dialog";
import "../../src/shared/styles/globals.css";
import { useEffect, useState, useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { WorkbenchShell } from "../../../apps/web/src/features/workbench/components/workbench-shell.js";

const probe = vi.hoisted(() => ({
  output: "初始输出",
  runtimeListeners: new Set<(delta: string) => void>(),
  viewListeners: new Set<() => void>(),
}));

type Context = {
  globalSettingsSection: "appearance" | null;
  setGlobalSettingsSection: (section: "appearance" | null) => void;
};

const subscribeView = (listener: () => void) => {
  probe.viewListeners.add(listener);
  return () => probe.viewListeners.delete(listener);
};
const getOutput = () => probe.output;

vi.mock("../../../apps/web/src/features/workbench/components/workbench-shell-runtime.js", () => ({
  useWorkbenchShellRuntime: () => {
    const [globalSettingsSection, setGlobalSettingsSection] = useState<"appearance" | null>(null);
    // 模拟界面之外的事件接收；打开设置时继续接收任务事件。
    useEffect(() => {
      const onEvent = (delta: string) => {
        probe.output += delta;
        probe.viewListeners.forEach((listener) => listener());
      };
      probe.runtimeListeners.add(onEvent);
      return () => {
        probe.runtimeListeners.delete(onEvent);
      };
    }, []);
    return { globalSettingsSection, setGlobalSettingsSection, t: (key: string) => key };
  },
}));
vi.mock(
  "../../../apps/web/src/features/workbench/components/workbench-shell-controller.js",
  () => ({
    useWorkbenchShellController: (context: unknown) => context,
  }),
);
vi.mock("../../../apps/web/src/features/workbench/components/workbench-settings-page.js", () => ({
  WorkbenchSettingsPage: ({ context }: { context: Context }) =>
    context.globalSettingsSection === null ? null : (
      <SettingsDialog
        title="设置"
        closeLabel="返回工作台"
        onClose={() => context.setGlobalSettingsSection(null)}
      >
        <p>设置内容</p>
      </SettingsDialog>
    ),
}));
vi.mock("../../../apps/web/src/features/workbench/components/workbench-shell-layout.js", () => ({
  WorkbenchShellLayout: ({ context }: { context: Context }) => {
    const [draft, setDraft] = useState("");
    const output = useSyncExternalStore(subscribeView, getOutput);
    return (
      <main aria-label="工作台">
        <textarea
          aria-label="草稿"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <div data-testid="timeline" style={{ height: 80, overflow: "auto" }}>
          <div style={{ height: 800 }}>{output}</div>
        </div>
        <button onClick={() => context.setGlobalSettingsSection("appearance")}>打开设置</button>
      </main>
    );
  },
}));

beforeEach(() => {
  probe.output = "初始输出";
  probe.runtimeListeners.clear();
  probe.viewListeners.clear();
});

describe("Web 设置的工作台模态边界", () => {
  it.each([1440, 390])("在 %s 宽度保留工作台状态和后台输出", async (width) => {
    await page.viewport(width, 900);
    const screen = await render(<WorkbenchShell projectId="settings-activity" taskId="task-1" />);
    await screen.getByRole("textbox", { name: "草稿" }).fill("未发送草稿");
    const timeline = screen.getByTestId("timeline").element();
    timeline.scrollTop = 240;
    expect(probe.runtimeListeners.size).toBe(1);
    expect(probe.viewListeners.size).toBe(1);

    // 连续打开两次，确认订阅不会累积，草稿与滚动位置也不会重置。
    for (let round = 0; round < 2; round++) {
      await screen.getByRole("button", { name: "打开设置" }).click();
      await expect.element(screen.getByRole("dialog", { name: "设置" })).toBeVisible();
      // 模态期间背景仍参与布局，但从可访问树移除，无法通过键盘聚焦输入区。
      expect(timeline.getBoundingClientRect().height).toBeGreaterThan(0);
      await expect.element(screen.getByRole("textbox", { name: "草稿" })).not.toBeInTheDocument();
      await userEvent.tab();
      await expect.poll(() => document.activeElement?.closest('[role="dialog"]')).toBeTruthy();
      expect(probe.runtimeListeners.size).toBe(1);

      for (let index = 0; index < 120; index++) {
        probe.runtimeListeners.forEach((listener) => listener("增量"));
      }
      expect(probe.output).toBe(`初始输出${"增量".repeat((round + 1) * 120)}`);
      expect(probe.viewListeners.size).toBe(1);

      await screen.getByRole("button", { name: "返回工作台" }).click();
      await expect.element(screen.getByRole("textbox", { name: "草稿" })).toHaveValue("未发送草稿");
      await expect.element(screen.getByTestId("timeline")).toHaveTextContent(probe.output);
      expect(screen.getByTestId("timeline").element()).toBe(timeline);
      expect(timeline.scrollTop).toBe(240);
      expect(probe.viewListeners.size).toBe(1);
    }
    await screen.unmount();
    expect(probe.runtimeListeners.size).toBe(0);
    expect(probe.viewListeners.size).toBe(0);
  });
});
