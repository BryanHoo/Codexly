import { expect, it, vi } from "vitest";
import type { AcpSessionState } from "@codexly/protocol";
import { AcpSessionStateController } from "./acp-session-state.js";

const initial: AcpSessionState = {
  configOptions: [{ id: "mode", name: "模式", type: "boolean", currentValue: false }],
  availableCommands: [{ name: "review", description: "检查" }],
};

it("读取期间到达的完整事件阻止迟到读取覆盖，重复状态不重复通知", () => {
  const controller = new AcpSessionStateController();
  const changed = vi.fn();
  controller.subscribe(changed);
  const pending = controller.capture();
  controller.receive(initial);
  expect(controller.commitRead(pending, { configOptions: [], availableCommands: [] })).toBe(false);
  expect(controller.getSnapshot()).toBe(initial);
  const beforeDuplicate = controller.capture();
  controller.receive({ ...initial });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(controller.commitRead(beforeDuplicate, { configOptions: [], availableCommands: [] })).toBe(
    false,
  );
});

it("任务控制器隔离在途响应，卸载后释放监听且不再写入", () => {
  const a = new AcpSessionStateController(),
    b = new AcpSessionStateController();
  expect(b.commitRead(a.capture(), initial)).toBe(false);
  const changed = vi.fn(),
    stop = a.subscribe(changed);
  stop();
  a.receive(initial);
  expect(changed).not.toHaveBeenCalled();
  const pending = a.capture();
  a.dispose();
  expect(a.commitRead(pending, initial)).toBe(false);
  a.receive({ configOptions: [], availableCommands: [] });
  expect(a.getSnapshot()).toBe(initial);
});

it("配置响应完整替换选项并保留命令，更新事件优先于旧保存响应", () => {
  const controller = new AcpSessionStateController();
  controller.receive(initial);
  const stale = controller.capture();
  const newer = { ...initial, availableCommands: [{ name: "new", description: "新命令" }] };
  controller.receive(newer);
  expect(controller.commitConfiguration(stale, [])).toBe(false);
  expect(controller.getSnapshot()).toBe(newer);
  expect(controller.commitConfiguration(controller.capture(), [])).toBe(true);
  expect(controller.getSnapshot()).toEqual({
    configOptions: [],
    availableCommands: newer.availableCommands,
  });
});
