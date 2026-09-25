import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { terminalStore } from "../../terminal/terminal-store.js";
import { TerminalWorkbench } from "../../terminal/components/terminal-workbench.js";
import { WorkbenchShell } from "./workbench-shell.js";
import { WorkbenchShortcuts } from "./workbench-shortcuts.js";

const { onNewTask, initializeTerminalLayout } = vi.hoisted(() => ({
  onNewTask: vi.fn(),
  initializeTerminalLayout: vi.fn(async () => undefined),
}));
type Context = {
  globalSettingsSection: "appearance" | null;
  setGlobalSettingsSection: (section: "appearance" | null) => void;
};

vi.mock("./workbench-shell-runtime.js", () => ({
  useWorkbenchShellRuntime: () => {
    const [globalSettingsSection, setGlobalSettingsSection] = useState<"appearance" | null>(null);
    return { globalSettingsSection, setGlobalSettingsSection };
  },
}));
vi.mock("./workbench-shell-controller.js", () => ({ useWorkbenchShellController: (value: unknown) => value }));
vi.mock("../../pets/components/workbench-pet-layer.js", () => ({ WorkbenchPetLayer: () => null }));
vi.mock("../../terminal/terminal-layout.js", () => ({ initializeTerminalLayout, terminalActionError: vi.fn() }));
vi.mock("../../terminal/components/terminal-panel.js", () => ({ TerminalPanel: () => <div>Terminal output</div> }));
vi.mock("./workbench-settings-page.js", () => ({
  WorkbenchSettingsPage: ({ context }: { context: Context }) => context.globalSettingsSection === null ? null : (
    <main aria-label="Settings"><button onClick={() => context.setGlobalSettingsSection(null)}>Back to app</button></main>
  ),
}));
vi.mock("./workbench-shell-layout.js", () => ({
  WorkbenchShellLayout: ({ context }: { context: Context }) => {
    const [draft, setDraft] = useState("");
    return (
      <TerminalWorkbench enabled label="Workbench" projectId="settings-navigation" rootId={undefined} taskId="task-1">
        <WorkbenchShortcuts onNewTask={onNewTask} />
        <textarea aria-label="Draft" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
        <button onClick={() => context.setGlobalSettingsSection("appearance")}>Open settings</button>
      </TerminalWorkbench>
    );
  },
}));

function newTaskShortcut() {
  const mac = /mac/i.test(navigator.platform);
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "n", metaKey: mac, ctrlKey: !mac }));
}

describe("workbench settings navigation", () => {
  it("preserves the draft and terminal while suspending hidden workbench shortcuts", async () => {
    const screen = await render(<WorkbenchShell projectId="settings-navigation" taskId="task-1" />);
    await expect.poll(() => initializeTerminalLayout.mock.calls.length).toBe(1);
    await screen.getByRole("textbox", { name: "Draft" }).fill("Unsent draft");
    terminalStore.update("settings-navigation", { visible: true });
    await expect.element(screen.getByText("Terminal output")).toBeVisible();
    await screen.getByRole("button", { name: "Open settings" }).click();
    await expect.element(screen.getByRole("main", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Draft" }).all()).toHaveLength(0);
    newTaskShortcut();
    expect(onNewTask).not.toHaveBeenCalled();

    await screen.getByRole("button", { name: "Back to app" }).click();
    await expect.element(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("Unsent draft");
    expect(terminalStore.get("settings-navigation").visible).toBe(true);
    await expect.element(screen.getByText("Terminal output")).toBeVisible();
    expect(initializeTerminalLayout).toHaveBeenCalledOnce();
    newTaskShortcut();
    expect(onNewTask).toHaveBeenCalledOnce();
  });
});
