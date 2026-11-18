import { expect, it, vi } from "vitest";
import { AgentTurnNotSubmittedError } from "@codexly/core";
import { submitAcpTurn } from "./turn-submission.js";

it("未提交失败等待回滚完成，保留原有未提交错误身份", async () => {
  const gate = Promise.withResolvers<undefined>();
  const error = new AgentTurnNotSubmittedError("配置失败");
  const cleanup = vi.fn(() => gate.promise);
  const result = submitAcpTurn((_submitted, onRollback) => {
    onRollback(cleanup);
    return Promise.reject(error);
  });
  const settled = vi.fn();
  const assertion = expect(result).rejects.toBe(error);
  void result.then(settled, settled);
  await vi.waitFor(() => {
    expect(cleanup).toHaveBeenCalledOnce();
  });
  expect(settled).not.toHaveBeenCalled();
  gate.resolve(undefined);
  await assertion;
});

it("提交边界之后的失败不回滚，也不误报未提交", async () => {
  const cleanup = vi.fn();
  const error = new Error("传输结果未知");
  await expect(
    submitAcpTurn((submitted, onRollback) => {
      onRollback(cleanup);
      submitted();
      return Promise.reject(error);
    }),
  ).rejects.toBe(error);
  expect(cleanup).not.toHaveBeenCalled();
});

it("回滚失败明确报告并保留原始与清理错误", async () => {
  const original = new Error("会话失败");
  const cleanupError = new Error("磁盘拒绝删除");
  const result = submitAcpTurn((_submitted, onRollback) => {
    onRollback(() => Promise.reject(cleanupError));
    return Promise.reject(original);
  });
  await expect(result).rejects.toMatchObject({
    name: "AgentTurnNotSubmittedError",
    message: "ACP 输入未提交，附件清理失败",
    cause: { errors: [original, cleanupError] },
  });
});
