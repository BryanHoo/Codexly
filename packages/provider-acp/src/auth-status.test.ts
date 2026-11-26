import { expect, it, vi } from "vitest";
import { AcpAuthStatusTracker } from "./auth-status.js";

it("延迟推送唤醒检测，后续登出替换旧账号", async () => {
  const tracker = new AcpAuthStatusTracker();
  const pending = tracker.read(true);
  tracker.update({
    authStatus: { kind: "gateway", label: "Custom gateway", detail: "local-gateway" },
  });
  expect(await pending).toMatchObject({ kind: "gateway", detail: "local-gateway" });
  tracker.update({ authStatus: { kind: "none", label: "Not logged in" } });
  expect(await tracker.read(true)).toEqual({ kind: "none", label: "Not logged in" });
});
it("异常或过长载荷不能伪造已登录，检测超时保持未知", async () => {
  vi.useFakeTimers();
  try {
    const tracker = new AcpAuthStatusTracker();
    const pending = tracker.read(true, 10);
    tracker.update({ authStatus: { kind: "account", label: "x".repeat(513), token: "secret" } });
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it("关闭连接立即释放探测等待和计时器", async () => {
  vi.useFakeTimers();
  try {
    const tracker = new AcpAuthStatusTracker();
    const pending = tracker.read(true);
    tracker.close();
    expect(await pending).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
