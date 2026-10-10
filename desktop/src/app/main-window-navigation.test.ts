import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMainWindowNavigation } from "./main-window-navigation.js";

const { listenMainWindowNavigation, requestSplitTaskNavigation } = vi.hoisted(() => ({
  listenMainWindowNavigation: vi.fn(),
  requestSplitTaskNavigation: vi.fn(() => false),
}));

vi.mock("@codexly/frontend-core/split-task-navigation", () => ({
  requestSplitTaskNavigation,
}));

vi.mock("../platform/tauri/main-window-navigation.js", () => ({
  listenMainWindowNavigation,
}));

describe("main window navigation", () => {
  beforeEach(() => {
    listenMainWindowNavigation.mockReset();
    requestSplitTaskNavigation.mockReset();
  });

  it.each([
    ["p/project%20%2F%201/t/task%20%2F%201", "project / 1", "task / 1"],
    ["/temporary/t/task%20%2F%201", "temporary", "task / 1"],
  ])("分屏接管原生通知任务，保留布局：%s", async (route, projectId, taskId) => {
    let routeListener: ((route: string) => void) | undefined;
    listenMainWindowNavigation.mockImplementation((listener: (route: string) => void) => {
      routeListener = listener;
      return Promise.resolve(vi.fn());
    });
    requestSplitTaskNavigation.mockReturnValue(true);
    const navigate = vi.fn();
    await installMainWindowNavigation(navigate);

    routeListener?.(route);

    expect(requestSplitTaskNavigation).toHaveBeenCalledWith({ projectId, taskId });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("通过现有 Router 打开宠物气泡与状态栏请求的任务路由", async () => {
    const unlisten = vi.fn();
    let routeListener: ((route: string) => void) | undefined;
    listenMainWindowNavigation.mockImplementation(
      (listener: (route: string) => void) => {
        routeListener = listener;
        return Promise.resolve(unlisten);
      },
    );
    const navigate = vi.fn();
    const dispose = await installMainWindowNavigation(navigate);
    routeListener?.("p/project-1/t/task-1");

    expect(navigate).toHaveBeenCalledWith("/p/project-1/t/task-1");
    dispose();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
