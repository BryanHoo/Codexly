import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { ProjectSidebarWorktreeAction } from "./project-sidebar-worktree-action.js";
import "../../../shared/styles/globals.css";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn(async () => undefined) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../../notifications/action-notifications.js", () => ({ notifyActionError: vi.fn() }));

it("creates a task in the original project and retries without recreating its worktree", async () => {
  await i18n.changeLanguage("zh-CN");
  const project = {
    id: "project",
    name: "Repo",
    roots: [{ id: "root", path: "/repo" }],
    createdAt: "2026-09-29T00:00:00Z",
  };
  const task = {
    id: "task",
    projectId: project.id,
    pinned: false,
    title: "topic",
    updatedAt: project.createdAt,
    workspacePath: "/repo-topic",
  };
  const client = {
    getProjectGitStatus: vi
      .fn()
      .mockResolvedValue({ repositoryMode: "root", snapshot: "snapshot" }),
    createTaskWorktree: vi.fn().mockResolvedValue({ worktree: { path: task.workspacePath } }),
    startWorktreeTask: vi
      .fn()
      .mockRejectedValueOnce(new Error("Start failed"))
      .mockResolvedValueOnce({ task }),
  };
  const onCreated = vi.fn();
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <ProjectSidebarWorktreeAction client={client} project={project} onCreated={onCreated} />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  await screen.getByRole("button", { name: "在 Repo 中创建 worktree 任务" }).click();
  const branch = screen.getByRole("textbox", { name: "分支名称" });
  await branch.fill("feature/topic");
  const submit = screen.getByRole("button", { name: "创建 worktree 和任务" });
  await submit.click();
  await expect.element(branch).toBeDisabled();
  await expect.element(submit).toBeEnabled();
  await submit.click();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  expect(client.createTaskWorktree).toHaveBeenCalledTimes(1);
  expect(client.startWorktreeTask).toHaveBeenCalledTimes(2);
  expect(onCreated).toHaveBeenCalledWith(project.id);
  expect(navigate).toHaveBeenCalledWith({
    to: "/p/$projectId/t/$taskId",
    params: { projectId: project.id, taskId: task.id },
  });
});
