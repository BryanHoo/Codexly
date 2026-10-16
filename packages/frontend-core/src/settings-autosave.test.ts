import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsAutosave } from "./settings-autosave.js";

afterEach(() => vi.useRealTimers());
describe("设置自动保存", () => {
  it("合并连续输入，失焦立即提交，已保存值不重复写入", async () => {
    vi.useFakeTimers();
    const save = vi.fn((_value: string) => Promise.resolve());
    const queue = createSettingsAutosave(save);
    queue.reset("原文");
    queue.schedule("第一个草稿");
    queue.schedule("最后草稿");
    expect(save).not.toHaveBeenCalled();
    await queue.flush();
    expect(save.mock.calls).toEqual([["最后草稿"]]);
    queue.save("最后草稿");
    await queue.flush();
    expect(save).toHaveBeenCalledOnce();
    expect(queue.status).toBe("saved");
  });
  it("串行补存请求期间的新选择，失败保留最新值供重试", async () => {
    let release!: () => void;
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const queue = createSettingsAutosave(save);
    queue.save("旧选择");
    queue.save("新选择");
    expect(save).toHaveBeenCalledOnce();
    release();
    expect(await queue.flush()).toBe(false);
    expect(queue.status).toBe("error");
    expect(save.mock.calls).toEqual([["旧选择"], ["新选择"]]);
    expect(await queue.retry()).toBe(true);
    expect(save.mock.calls).toEqual([["旧选择"], ["新选择"], ["新选择"]]);
  });
  it("停止输入后保存；撤回原值时取消待提交草稿", async () => {
    vi.useFakeTimers();
    const save = vi.fn((_value: string) => Promise.resolve());
    const queue = createSettingsAutosave(save);
    queue.reset("原文");
    queue.schedule("草稿");
    await vi.advanceTimersByTimeAsync(400);
    expect(save).toHaveBeenCalledWith("草稿");
    queue.schedule("临时输入");
    queue.schedule("草稿");
    await vi.advanceTimersByTimeAsync(400);
    expect(save).toHaveBeenCalledOnce();
  });
  it("输入尚未完整时取消定时提交，重新加载后丢弃失败快照", async () => {
    vi.useFakeTimers();
    const save = vi.fn<(value: string) => Promise<void>>().mockRejectedValue(new Error("offline"));
    const queue = createSettingsAutosave(save);
    queue.schedule("旧地址");
    queue.cancelScheduled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    queue.save("草稿");
    expect(await queue.flush()).toBe(false);
    queue.discard();
    expect(await queue.retry()).toBe(true);
    expect(queue.status).toBe("idle");
    expect(save).toHaveBeenCalledOnce();
  });
});
