import { beforeEach, describe, expect, it, vi } from "vitest";

const listen = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({ listen }));

describe("main window navigation client", () => {
  beforeEach(() => {
    listen.mockReset();
  });

  it("转发原生层发出的主窗口 SPA 路由", async () => {
    const unlisten = vi.fn();
    let eventListener: ((event: { payload: string }) => void) | undefined;
    listen.mockImplementation(
      (_eventName: string, listener: (event: { payload: string }) => void) => {
        eventListener = listener;
        return Promise.resolve(unlisten);
      },
    );
    const listener = vi.fn();
    const { listenMainWindowNavigation } = await import("./main-window-navigation.js");

    await expect(listenMainWindowNavigation(listener)).resolves.toBe(unlisten);
    expect(listen).toHaveBeenCalledWith("main-window://navigate", expect.any(Function));

    eventListener?.({ payload: "temporary/t/task-1" });
    expect(listener).toHaveBeenCalledWith("temporary/t/task-1");
  });
});
