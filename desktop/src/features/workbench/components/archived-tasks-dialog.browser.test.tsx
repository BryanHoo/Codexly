import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { NativeArchivedTaskClient } from "../../projects/project-queries.js";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { ArchivedTasksDialog } from "./archived-tasks-dialog.js";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

test("confirms a custom cutoff and deletes only older archived tasks through the native client", async () => {
  await i18n.changeLanguage("zh-CN");
  const tasks = [
    { id: "old", title: "旧归档", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "recent", title: "近期归档", updatedAt: "2026-10-20T00:00:00Z" },
  ].map((task) => ({ ...task, projectId: "project", pinned: false }));
  const deleted = new Set<string>();
  const client = {
    listTasks: vi
      .fn<NativeArchivedTaskClient["listTasks"]>()
      .mockImplementation(async () => ({
        data: tasks.filter((task) => !deleted.has(task.id)),
        nextCursor: null,
      })),
    deleteTask: vi
      .fn<NativeArchivedTaskClient["deleteTask"]>()
      .mockImplementation(async (_project, id) => {
        deleted.add(id);
        return { status: "deleted", taskId: id };
      }),
    unarchiveTask: vi.fn<NativeArchivedTaskClient["unarchiveTask"]>(),
  };
  const screen = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <ArchivedTasksDialog
          client={client}
          onClose={vi.fn()}
          project={{ id: "project", name: "测试项目" }}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await expect.element(screen.getByText("旧归档", { exact: true })).toBeVisible();
  await screen.getByRole("combobox", { name: "选择归档删除范围" }).selectOptions("custom");
  await expect.element(screen.getByRole("button", { name: "按日期删除" })).toBeDisabled();
  await screen.getByLabelText("删除此日期之前的归档任务").fill("2026-07-24");
  await screen.getByRole("button", { name: "按日期删除" }).click();
  await expect.element(screen.getByText("按日期永久删除已归档任务", { exact: true })).toBeVisible();
  expect(client.deleteTask).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "取消", exact: true }).click();
  expect(client.deleteTask).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "按日期删除" }).click();
  await screen.getByRole("button", { name: "永久删除", exact: true }).click();
  await expect.poll(() => client.deleteTask.mock.calls).toEqual([["project", "old"]]);
  await expect.element(screen.getByText("近期归档", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("旧归档", { exact: true })).not.toBeInTheDocument();
});
