import { expect, it, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { AgentTurnNotSubmittedError } from "@codexly/core";
import { fixture, input } from "./provider.test-support.js";

it("真实会话先应用宿主默认值，显式切换失败时不启动回合", async () => {
  const enabled = { id: "enabled", name: "开关", type: "boolean" as const };
  const initialize = vi.fn(() => Promise.resolve([{ ...enabled, currentValue: true }]));
  const prompt = vi.fn(() => Promise.resolve({ stopReason: "end_turn" as const }));
  const f = await fixture("claude", prompt, initialize);
  f.created.mockReturnValue({
    sessionId: "native",
    configOptions: [{ ...enabled, currentValue: false }],
  });
  const write = vi
    .fn()
    .mockRejectedValueOnce(new Error("无法切换"))
    .mockResolvedValue({
      configOptions: [{ ...enabled, currentValue: false }],
    });
  f.app.onRequest(acp.methods.agent.session.setConfigOption, write);
  const task = await f.provider.startTask();
  const request = { ...input, acpConfigOverrides: { enabled: false } };
  await expect(f.provider.startConfiguredTurn(task.id, request)).rejects.toBeInstanceOf(
    AgentTurnNotSubmittedError,
  );
  expect(prompt).not.toHaveBeenCalled();
  expect(initialize).toHaveBeenCalledBefore(write);
  await f.provider.startConfiguredTurn(task.id, request);
  await vi.waitFor(() => {
    expect(prompt).toHaveBeenCalledOnce();
  });
  expect(f.created).toHaveBeenCalledOnce();
});
it("首发配置失败明确未发送，重试沿用同一会话且只执行一次 prompt", async () => {
  const prompted = vi.fn(() => Promise.resolve({ stopReason: "end_turn" as const }));
  const f = await fixture("claude", prompted);
  f.created.mockReturnValue({
    sessionId: "native",
    configOptions: [{ id: "enabled", name: "开关", type: "boolean", currentValue: true }],
  });
  const set = vi
    .fn()
    .mockRejectedValueOnce(new Error("配置失败"))
    .mockResolvedValue({
      configOptions: [{ id: "enabled", name: "开关", type: "boolean", currentValue: false }],
    });
  f.app.onRequest(acp.methods.agent.session.setConfigOption, set);
  const task = await f.provider.startTask();
  await expect(
    f.provider.startConfiguredTurn(task.id, input, { enabled: false }),
  ).rejects.toBeInstanceOf(AgentTurnNotSubmittedError);
  expect(prompted).not.toHaveBeenCalled();
  await f.provider.startConfiguredTurn(task.id, input, { enabled: false });
  await vi.waitFor(() => {
    expect(prompted).toHaveBeenCalledOnce();
  });
  expect(f.created).toHaveBeenCalledOnce();
  expect(set).toHaveBeenCalledTimes(2);
});

it("任务已有消息后拒绝旧草稿的首发配置，不覆盖会话或再次发送", async () => {
  const f = await fixture("claude");
  f.created.mockReturnValue({
    sessionId: "native",
    configOptions: [{ id: "enabled", name: "开关", type: "boolean", currentValue: true }],
  });
  const set = vi.fn(() => ({ configOptions: [] }));
  f.app.onRequest(acp.methods.agent.session.setConfigOption, set);
  const task = await f.provider.startTask();
  await f.provider.startConfiguredTurn(task.id, input);
  await expect(
    f.provider.startConfiguredTurn(task.id, input, { enabled: false }),
  ).rejects.toBeInstanceOf(AgentTurnNotSubmittedError);
  expect(set).not.toHaveBeenCalled();
});
