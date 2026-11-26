import { expect, it, vi } from "vitest";
import type { AgentProviderEventListener } from "@codexly/core";
import type { AgentTurn } from "@codexly/protocol";
import { AcpEventProjection } from "./event-projection.js";
import { generateAcpText } from "./text-generation.js";

it.each([
  { status: "completed" },
  { status: "completed", stopReason: "future_reason" },
  { status: "failed", stopReason: "end_turn" },
] as const)("辅助生成拒绝不满足完整成功条件的回合：%j", async (state) => {
  let receive: AgentProviderEventListener = () => undefined;
  const turn: AgentTurn = {
    id: "turn",
    startedAt: null,
    completedAt: null,
    error: null,
    items: [],
    ...state,
  };
  await expect(
    generateAcpText(
      {
        create: () => Promise.resolve({ id: "task" }),
        subscribe: (listener) => {
          receive = listener;
          return () => undefined;
        },
        start: () => {
          receive({ type: "turn.completed", taskId: "task", turnId: "turn", payload: { turn } });
          return Promise.resolve(turn);
        },
        interrupt: () => Promise.resolve(),
        release: () => Promise.resolve(),
      },
      "生成",
      undefined,
      new AbortController().signal,
    ),
  ).rejects.toThrow("未成功结束");
});

it.each(["end_turn", "refusal", "max_tokens", "max_turn_requests", "cancelled"] as const)(
  "辅助生成仅接受正常结束，停止原因为 %s 时仍释放会话",
  async (reason) => {
    let receive: AgentProviderEventListener = () => undefined;
    const unsubscribe = vi.fn();
    const release = vi.fn(() => Promise.resolve());
    const result = generateAcpText(
      {
        create: () => Promise.resolve({ id: "task" }),
        subscribe: (listener) => {
          receive = listener;
          return unsubscribe;
        },
        start: () => {
          const projection = new AcpEventProjection("task", "turn", (event) => {
            receive(event);
          });
          // 即使正文是可解析的完整结果，拒绝或截断仍不能被自动化流程接收。
          projection.update({
            sessionUpdate: "agent_message_chunk",
            messageId: "test-message",
            content: { type: "text", text: '{"title":"部分结果"}' },
          });
          return Promise.resolve(projection.finish(reason));
        },
        interrupt: () => Promise.resolve(),
        release,
      },
      "生成标题",
      undefined,
      new AbortController().signal,
    );
    if (reason === "end_turn") await expect(result).resolves.toBe('{"title":"部分结果"}');
    else await expect(result).rejects.toThrow(reason);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledExactlyOnceWith("task");
  },
);
