import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestSplitTaskNavigation,
  subscribeSplitTaskNavigation,
} from "./split-task-navigation.js";

const pane = { projectId: "project", taskId: "task" };

describe("外部任务分屏导航", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("没有浏览器或工作区监听时回退到路由", () => {
    expect(requestSplitTaskNavigation(pane)).toBe(false);
    vi.stubGlobal("window", new EventTarget());
    expect(requestSplitTaskNavigation(pane)).toBe(false);
  });

  it("同步返回工作区接管结果，卸载后不再拦截路由", () => {
    vi.stubGlobal("window", new EventTarget());
    const select = vi.fn(() => true);
    const dispose = subscribeSplitTaskNavigation(select);
    expect(requestSplitTaskNavigation(pane)).toBe(true);
    expect(select).toHaveBeenCalledWith(pane);
    dispose();
    expect(requestSplitTaskNavigation(pane)).toBe(false);
    expect(select).toHaveBeenCalledOnce();
  });

  it("单窗口和移动端拒绝接管时保留平台导航", () => {
    vi.stubGlobal("window", new EventTarget());
    const dispose = subscribeSplitTaskNavigation(() => false);
    expect(requestSplitTaskNavigation(pane)).toBe(false);
    dispose();
  });

  it("一次通知只交给一个工作区处理", () => {
    vi.stubGlobal("window", new EventTarget());
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const disposeFirst = subscribeSplitTaskNavigation(first);
    const disposeSecond = subscribeSplitTaskNavigation(second);
    expect(requestSplitTaskNavigation(pane)).toBe(true);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    disposeFirst();
    disposeSecond();
  });
});
