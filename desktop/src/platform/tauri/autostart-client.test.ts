import { beforeEach, expect, test, vi } from "vitest";
import { getAutostartEnabled, setAutostartEnabled } from "./autostart-client.js";
import { invoke } from "./native-invoke.js";

vi.mock("./native-invoke.js", () => ({ invoke: vi.fn() }));
const nativeInvoke = vi.mocked(invoke);
beforeEach(() => nativeInvoke.mockReset());

test("读取系统登录启动状态", async () => {
  nativeInvoke.mockResolvedValueOnce(true);
  await expect(getAutostartEnabled()).resolves.toBe(true);
  expect(nativeInvoke).toHaveBeenCalledWith("plugin:autostart|is_enabled");
});

test.each([true, false])("切换为 %s 后以系统回读结果为准", async (enabled) => {
  nativeInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce(enabled);
  await expect(setAutostartEnabled(enabled)).resolves.toBe(enabled);
  expect(nativeInvoke.mock.calls).toEqual([
    [`plugin:autostart|${enabled ? "enable" : "disable"}`],
    ["plugin:autostart|is_enabled"],
  ]);
});

test("系统拒绝写入时向界面报告失败", async () => {
  nativeInvoke.mockRejectedValueOnce(new Error("permission denied"));
  await expect(setAutostartEnabled(true)).rejects.toThrow("permission denied");
  expect(nativeInvoke).toHaveBeenCalledTimes(1);
});

test("系统状态未达到请求值时不能显示保存成功", async () => {
  nativeInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce(false);
  await expect(setAutostartEnabled(true)).rejects.toThrow("AUTOSTART_STATE_MISMATCH");
});
