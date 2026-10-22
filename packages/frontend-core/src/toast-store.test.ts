import { afterEach, describe, expect, it, vi } from "vitest";
import { createToastStore } from "./toast-store.js";

afterEach(() => vi.useRealTimers());

describe("通用通知生命周期", () => {
  it.each([
    ["success", 2000],
    ["info", 3000],
    ["warning", 4000],
    ["error", 4000],
  ] as const)("%s 在缩短后的 %i 毫秒到期", async (type, duration) => {
    vi.useFakeTimers();
    const store = createToastStore();
    store.show(type, "通知");
    await vi.advanceTimersByTimeAsync(duration - 1);
    expect(store.getSnapshot()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getSnapshot()).toEqual([]);
  });
  it("最多保留三条新通知，淘汰旧通知且不排队补播", async () => {
    vi.useFakeTimers();
    const store = createToastStore();
    for (const message of ["一", "二", "三", "四", "五"]) store.show("success", message);
    expect(store.getSnapshot().map((item) => item.message)).toEqual(["五", "四", "三"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("重复通知合并而不延长原来的截止时间，状态变化重新计时", async () => {
    vi.useFakeTimers();
    const store = createToastStore();
    const id = store.show("success", "已保存");
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.show("success", "已保存")).toBe(id);
    expect(store.getSnapshot()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot()).toHaveLength(0);
    store.show("error", "保存失败", { id: "settings" });
    await vi.advanceTimersByTimeAsync(3000);
    store.show("success", "已保存", { id: "settings" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot()[0]?.type).toBe("success");
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("只暂停交互中的一条通知，其他通知照常到期", async () => {
    vi.useFakeTimers();
    const store = createToastStore();
    const first = store.show("success", "第一条");
    store.show("success", "第二条");
    await vi.advanceTimersByTimeAsync(1000);
    store.pause(first, "pointer");
    store.pause(first, "focus");
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.getSnapshot().map((item) => item.message)).toEqual(["第一条"]);
    store.resume(first, "pointer");
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getSnapshot()).toHaveLength(1);
    store.resume(first, "focus");
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("后台过期通知在恢复时清除，关闭通知释放定时器与订阅", () => {
    vi.useFakeTimers();
    const store = createToastStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.show("error", "失败");
    vi.setSystemTime(Date.now() + 60_000);
    store.sweep();
    expect(store.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    unsubscribe();
    listener.mockClear();
    store.show("info", "提示");
    expect(listener).not.toHaveBeenCalled();
    store.dismiss();
    expect(vi.getTimerCount()).toBe(0);
  });
});
