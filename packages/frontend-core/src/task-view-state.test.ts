import { afterEach, expect, test, vi } from "vitest";
import { createTaskViewState } from "./task-view-state.js";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const target = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const windowTarget = new EventTarget();
  vi.stubGlobal("document", target);
  vi.stubGlobal("window", windowTarget);
  const read = vi.fn();
  const views = createTaskViewState(read);
  return { target, windowTarget, read, views };
}

test("多个分屏、同名跨项目任务各自登记，重复挂载只在最后一个观察者离开后注销", () => {
  const { views, read } = setup();
  const first = views.observe("p1", "t");
  const duplicate = views.observe("p1", "t");
  const other = views.observe("p2", "t");
  views.view("p2", "t");
  first();
  first();
  expect(views.isViewed("p1", "t")).toBe(true);
  read.mockClear();
  views.readVisible();
  expect(read.mock.calls).toEqual([
    ["p1", "t"],
    ["p2", "t"],
  ]);
  duplicate();
  expect(views.isViewed("p1", "t")).toBe(false);
  other();
  expect(views.isViewed("p2", "t")).toBe(false);
  views.dispose();
});

test("后台不消费通知，恢复可见或焦点时消费所有可见任务，释放后不再监听", () => {
  const { views, target, windowTarget, read } = setup();
  const stop = views.observe("p", "t");
  target.visibilityState = "hidden";
  read.mockClear();
  views.view("p", "t");
  target.dispatchEvent(new Event("visibilitychange"));
  windowTarget.dispatchEvent(new Event("focus"));
  expect(views.isViewed("p", "t")).toBe(false);
  expect(read).not.toHaveBeenCalled();
  target.visibilityState = "visible";
  target.dispatchEvent(new Event("visibilitychange"));
  expect(read).toHaveBeenCalledExactlyOnceWith("p", "t");
  read.mockClear();
  windowTarget.dispatchEvent(new Event("focus"));
  expect(read).toHaveBeenCalledExactlyOnceWith("p", "t");
  stop();
  read.mockClear();
  target.dispatchEvent(new Event("visibilitychange"));
  windowTarget.dispatchEvent(new Event("focus"));
  expect(read).not.toHaveBeenCalled();
  views.dispose();
});

test("删除任务、项目和销毁运行态清除可见与选择记录", () => {
  const { views, read, target } = setup();
  views.observe("p1", "t1");
  views.observe("p1", "t2");
  views.observe("p2", "t1");
  views.view("p1", "t1");
  views.forget("p1", "t1");
  expect(views.isViewed("p1", "t1")).toBe(false);
  expect(views.isViewed("p1", "t2")).toBe(true);
  views.forget("p1");
  expect(views.isViewed("p1", "t2")).toBe(false);
  expect(views.isViewed("p2", "t1")).toBe(true);
  views.dispose();
  read.mockClear();
  target.dispatchEvent(new Event("visibilitychange"));
  expect(read).not.toHaveBeenCalled();
  expect(views.isViewed("p2", "t1")).toBe(false);
});
