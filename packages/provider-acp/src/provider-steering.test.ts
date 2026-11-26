import { expect, it, vi } from "vitest";
import { AgentTurnNotSubmittedError } from "@codexly/core";
import { fixture, input } from "./provider.test-support.js";
import type { AgentTurnOptions } from "@codexly/protocol";

it("在活动回合内发送引导并随原回合保存，旧回合不能再次发送", async () => {
  const finish = Promise.withResolvers<{ stopReason: "end_turn" }>();
  const f = await fixture("codex", () => finish.promise, undefined, {
    steering: true,
  });
  const request = vi.fn((_params: unknown): { outcome: string; reason?: string } => ({
    outcome: "injected",
  }));
  f.app.onRequest(
    "_session/steering",
    (value) => value,
    ({ params }) => request(params),
  );
  const task = await f.provider.startTask();
  const turn = await f.provider.startTurn(task.id, input, {} as AgentTurnOptions);
  try {
    await expect
      .poll(async () => (await f.provider.readTask(task.id)).acpSession)
      .toMatchObject({
        canSteer: true,
        foreground: "running",
      });
    // Agent 可以先于本地状态发现目标已结束，明确拒绝时不得追加用户消息。
    request.mockReturnValueOnce({ outcome: "promptRequired", reason: "noRunningTurn" });
    await expect(
      f.provider.steerTurn(task.id, turn.id, { ...input, text: "未受理的引导" }),
    ).rejects.toBeInstanceOf(AgentTurnNotSubmittedError);
    expect((await f.provider.readTask(task.id)).turns[0]?.items).toHaveLength(1);
    request.mockClear();
    await f.provider.steerTurn(task.id, turn.id, { ...input, text: "改用另一个方案" });
    expect(request).toHaveBeenCalledExactlyOnceWith({
      sessionId: "native",
      prompt: [{ type: "text", text: "改用另一个方案" }],
      _meta: { steering: { idleBehavior: "promptRequired" } },
    });
    finish.resolve({ stopReason: "end_turn" });
    await expect
      .poll(async () => (await f.provider.readTask(task.id)).turns)
      .toMatchObject([
        {
          id: turn.id,
          status: "completed",
          items: [{ text: input.text }, { text: "改用另一个方案" }],
        },
      ]);
    await expect(f.provider.steerTurn(task.id, turn.id, input)).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
  } finally {
    finish.resolve({ stopReason: "end_turn" });
  }
});
