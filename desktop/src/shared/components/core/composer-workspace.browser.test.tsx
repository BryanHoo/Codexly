import type { SplitPaneIdentity } from "@codexly/frontend-core/split-workspace";
import { useComposerWorkspaceSelection } from "@codexly/ui/core/composer-workspace";
import {
  SplitWorkspaceGrid,
  SplitWorkspaceProvider,
  useNavigateSplitTask,
  useSplitWorkspaceActions,
} from "@codexly/ui/core/split-workspace";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

const original = { projectId: "project", taskId: "original" };
const worktreePath = "/workspace/project/.worktree/topic";

function Composer({
  pane,
  navigate,
}: {
  pane: SplitPaneIdentity;
  navigate: (taskId: string) => void;
}) {
  const workspace = useComposerWorkspaceSelection(pane.projectId, pane.taskId);
  const navigateSplitTask = useNavigateSplitTask();
  return (
    <>
      <output aria-label="Workspace path">{workspace.path ?? "original"}</output>
      <output aria-label="Current task">{pane.taskId ?? "draft"}</output>
      <button onClick={() => workspace.select(worktreePath)}>Select worktree</button>
      <button onClick={() => {
        if (!navigateSplitTask(pane.projectId, "created")) navigate("created");
      }}>Submit task</button>
    </>
  );
}

it.each([
  { desktop: false, width: 390 },
  { desktop: false, width: 1440 },
  { desktop: true, width: 1440 },
])("uses platform navigation after submitting a single worktree draft (%o)", async ({ desktop, width }) => {
  await page.viewport(width, 900);
  const navigate = vi.fn();
  const screen = await render(
    <SplitWorkspaceProvider current={original} routeKey="original" desktop={desktop}>
      <SplitWorkspaceGrid
        label="Workspace"
        sidebarOpen
        toggleSidebar={() => undefined}
        splitLabels={{ up: "Up", down: "Down", left: "Left", right: "Right", limit: "Limit" }}
      >
        {(pane) => <Composer pane={pane} navigate={navigate} />}
      </SplitWorkspaceGrid>
    </SplitWorkspaceProvider>,
  );
  await screen.getByRole("button", { name: "Select worktree" }).click();
  await expect.element(screen.getByLabelText("Workspace path")).toHaveTextContent(worktreePath);
  expect(navigate).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Submit task" }).click();
  expect(navigate).toHaveBeenCalledExactlyOnceWith("created");
});

function AddNeighbor() {
  const actions = useSplitWorkspaceActions();
  return <button onClick={() => actions?.add({ projectId: "project", taskId: "neighbor" })}>Add neighbor</button>;
}

it.each([false, true])("submits a worktree draft inside its split pane (desktop=%s)", async (desktop) => {
  await page.viewport(1440, 900);
  const navigate = vi.fn();
  const screen = await render(
    <SplitWorkspaceProvider current={original} routeKey="original" desktop={desktop}>
      <AddNeighbor />
      <SplitWorkspaceGrid
        label="Workspace"
        sidebarOpen
        toggleSidebar={() => undefined}
        splitLabels={{ up: "Up", down: "Down", left: "Left", right: "Right", limit: "Limit" }}
      >
        {(pane) => pane.taskId === "neighbor"
          ? <textarea aria-label="Neighbor draft" />
          : <Composer pane={pane} navigate={navigate} />}
      </SplitWorkspaceGrid>
    </SplitWorkspaceProvider>,
  );
  await screen.getByRole("button", { name: "Add neighbor" }).click();
  const neighbor = screen.getByRole("textbox", { name: "Neighbor draft" });
  await neighbor.fill("Unsent neighbor message");
  const editor = neighbor.element();
  await screen.getByRole("button", { name: "Select worktree" }).click();
  await expect.element(screen.getByLabelText("Workspace path")).toHaveTextContent(worktreePath);
  await screen.getByRole("button", { name: "Submit task" }).click();
  await expect.element(screen.getByLabelText("Current task")).toHaveTextContent("created");
  expect(navigate).not.toHaveBeenCalled();
  expect(neighbor.element()).toBe(editor);
  await expect.element(neighbor).toHaveValue("Unsent neighbor message");
});
