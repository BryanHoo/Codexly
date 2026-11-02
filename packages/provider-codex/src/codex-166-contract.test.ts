import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapAgentTurn } from "./codex-task-mapping.js";
import { mapNotification } from "./codex-protocol-mapping.test-support.js";

const cases = JSON.parse(
  readFileSync(new URL("../test/fixtures/codex-166-item-timings.json", import.meta.url), "utf8"),
) as { name: string; turn: Record<string, unknown>; invalid?: boolean; expected?: unknown }[];

describe("Codex 0.166 条目计时", () => {
  it.each(cases)("$name", ({ turn, invalid, expected }) => {
    if (invalid) {
      expect(() => mapAgentTurn(turn)).toThrow();
      return;
    }
    expect(mapAgentTurn(turn).itemTimings ?? null).toEqual(expected);
    // 完成事件与历史读取共用原生 Turn 映射，恢复后计时不能消失。
    expect(mapNotification("turn/completed", { threadId: "task-1", turn })?.payload).toMatchObject({
      turn: mapAgentTurn(turn),
    });
  });
});

describe("Codex 0.166 错误分类", () => {
  it.each([
    ["modelNotFound", "bad_request"],
    ["policyCapacityUnavailable", "policy_blocked"],
  ])("映射 %s 并保留原始解释", (codexErrorInfo, code) => {
    expect(
      mapNotification("error", {
        error: { codexErrorInfo, message: "服务端拒绝当前请求" },
        threadId: "task-1",
        turnId: "turn-1",
        willRetry: false,
      }),
    ).toMatchObject({ payload: { code, message: "服务端拒绝当前请求", willRetry: false } });
  });
});
