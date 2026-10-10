import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskDeletion } from "./use-task-deletion.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";

const task = vi.hoisted(() => ({ projectId: "project", id: "deleted", title: "待删除任务" }));
const mocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  navigate: vi.fn(),
  mutateAsync: vi.fn(),
  unsubscribeTask: vi.fn(),
  removeQueries: vi.fn(),
  forgetTask: vi.fn(),
  removeRuntime: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useState: () => [task, vi.fn()],
}));
vi.mock("@codexly/ui/core/split-workspace", () => ({
  useSplitWorkspaceActions: () => ({ dismiss: mocks.dismiss }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
  useQueryClient: () => ({ removeQueries: mocks.removeQueries }),
}));
vi.mock("../../projects/project-context.js", () => ({
  useProjectData: () => ({ client: { unsubscribeTask: mocks.unsubscribeTask } }),
  useProjectActions: () => ({ forgetTask: mocks.forgetTask }),
}));
vi.mock("../../projects/project-queries.js", () => ({
  cacheRemovedProjectTask: vi.fn(),
  taskDeleteMutationOptions: vi.fn(),
}));
vi.mock("../../conversation/runtime/use-task-runtime.js", () => ({
  removeRetainedTaskRuntime: mocks.removeRuntime,
}));

async function confirm(activeTaskId: string) {
  let deletion: ReturnType<typeof useTaskDeletion> | undefined;
  function Probe() {
    deletion = useTaskDeletion({
      actionLock: createAsyncActionLock(),
      activeProjectId: task.projectId,
      activeTaskId,
    });
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (deletion === undefined) throw new Error("删除测试未挂载");
  await deletion.confirmTaskDeletion();
}

describe("删除任务时保留分屏工作区", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutateAsync.mockResolvedValue({ taskId: task.id, tasks: [] });
    mocks.unsubscribeTask.mockResolvedValue(undefined);
  });

  it.each(["deleted", "other"])("删除 %s 路由下的分屏任务只关闭对应窗口", async (active) => {
    mocks.dismiss.mockReturnValue(true);
    await confirm(active);
    expect(mocks.dismiss).toHaveBeenCalledWith({ projectId: task.projectId, taskId: task.id });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.removeRuntime).toHaveBeenCalledWith(task.projectId, task.id);
    expect(mocks.unsubscribeTask).toHaveBeenCalledWith(task.projectId, task.id);
  });

  it("普通单窗口删除仍导航到空聊天", async () => {
    mocks.dismiss.mockReturnValue(false);
    await confirm(task.id);
    expect(mocks.navigate).toHaveBeenCalledWith({
      params: { projectId: task.projectId },
      to: "/p/$projectId",
    });
  });

  it("删除失败时保留窗口和订阅以便重试", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("删除失败"));
    await confirm(task.id);
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.unsubscribeTask).not.toHaveBeenCalled();
  });
});
