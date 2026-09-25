import { beforeEach, describe, expect, it, vi } from "vitest";

const listenMainWindowNavigation = vi.fn();

vi.mock("../platform/tauri/main-window-navigation.js", () => ({
  listenMainWindowNavigation,
}));

describe("main window navigation", () => {
  beforeEach(() => {
    listenMainWindowNavigation.mockReset();
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
    const { installMainWindowNavigation } = await import("./main-window-navigation.js");

    const dispose = await installMainWindowNavigation(navigate);
    routeListener?.("p/project-1/t/task-1");

    expect(navigate).toHaveBeenCalledWith("/p/project-1/t/task-1");
    dispose();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
