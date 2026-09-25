import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { I18nextProvider, i18n } from "../../i18n/i18n.js";

vi.mock("./scheduled-task-editor.js", () => ({
  ScheduledTaskEditor: ({ onOpenRun, openingRun }: { onOpenRun: (projectId: string, taskId: string) => void; openingRun: boolean }) =>
    <button disabled={openingRun} onClick={() => onOpenRun("project-a", "run-a")} type="button">查看执行</button>,
}));
vi.mock("./scheduled-task-list.js", () => ({
  ScheduledTaskList: ({ tasks, onSelect }: { tasks: { id: string; projectId: string }[]; onSelect: (task: unknown) => void }) =>
    <button onClick={() => onSelect(tasks[0])} type="button">选择任务</button>,
}));
import { ScheduledTasksContainer } from "./scheduled-tasks-container.js";

it.each(["deleted", "archived", "available"])("checks a %s run before navigating", async (state) => {
  await i18n.changeLanguage("zh-CN");
  const navigate = vi.fn();
  const response = { snapshot: { id: "run-a" } };
  const client = {
    listScheduledTasks: vi.fn(async () => ({ data: [{ id: "schedule-a", projectId: "project-a" }] })),
    readTask: vi.fn(async () => {
      if (state === "deleted") throw new Error("thread not loaded: run-a");
      return response;
    }),
    listTasks: vi.fn(async () => ({ data: state === "archived" ? [{ id: "run-a" }] : [], nextCursor: null })),
  };
  const queryClient = new QueryClient();
  const screen = await render(<I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
    <ScheduledTasksContainer projectId="project-a" temporary={false} context={{
      client, navigate, gitStatusQuery: {}, modelsQuery: {}, skillsQuery: {}, projects: [],
      t: (key: string) => i18n.t(key, { ns: "workbench" }),
    } as never} />
    <Toaster />
  </QueryClientProvider></I18nextProvider>);
  await expect.poll(() => client.listScheduledTasks.mock.calls.length).toBe(1);
  await screen.getByRole("button", { name: "选择任务" }).click();
  await screen.getByRole("button", { name: "查看执行" }).click();
  await expect.poll(() => navigate.mock.calls.length + screen.container.querySelectorAll("[data-sonner-toast]").length).toBe(1);
  expect(navigate.mock.calls.length).toBe(state === "available" ? 1 : 0);
  expect(queryClient.getQueryData(["projects", "project-a", "tasks", "run-a"])).toEqual(state === "available" ? response : undefined);
  expect(screen.container.textContent?.includes("任务已删除、归档或不可用。")).toBe(state !== "available");
  await expect.element(screen.getByRole("button", { name: "查看执行" })).toBeEnabled();
  await screen.unmount();
  queryClient.clear();
});
