import { describe, expect, it } from "vitest";
import type { AgentTurn } from "@codexly/protocol";
import type { AgentProviderTaskSnapshot } from "./agent-provider.js";
import {
  collectQuestionGroups,
  formatQuestionAnswers,
  restoreAsyncQuestionAnswers,
  type AsyncQuestionRecord,
} from "./async-question.js";

describe("async question domain", () => {
  const message = {
    id: "live-id",
    type: "message" as const,
    role: "assistant" as const,
    text: "补充说明",
    questions: [
      { title: "选择范围", options: ["当前文件", "整个项目"] },
      { title: "要求", options: null },
    ],
  };
  const turn: AgentTurn = {
    id: "turn-1",
    startedAt: "2026-09-12T00:00:00.000Z",
    completedAt: null,
    error: null,
    status: "running",
    items: [message],
  };
  const identity = (value: string) => value;
  it("keeps question identities stable across native message id changes", () => {
    const first = collectQuestionGroups([turn], identity);
    const restored = collectQuestionGroups(
      [{ ...turn, items: [{ ...message, id: "item-1" }] }],
      identity,
    );
    expect(restored).toEqual(first);
  });
  it("distinguishes repeated groups and never infers answers from ordinary text", () => {
    const groups = collectQuestionGroups(
      [
        {
          ...turn,
          items: [
            message,
            {
              id: "reply",
              type: "message",
              role: "user",
              text: "选择范围\n当前文件\n\n要求\n保留测试",
            },
            { ...message, id: "another" },
          ],
        },
      ],
      identity,
    );
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((item) => item.id)).size).toBe(2);
    expect(collectQuestionGroups([{ ...turn, id: "turn-2" }], identity)[0]?.id).not.toBe(
      groups[0]?.id,
    );
  });
  it("formats only complete structured answers using authoritative question titles", () => {
    expect(formatQuestionAnswers(message.questions, ["整个项目", " 保留测试 "])).toBe(
      "选择范围\n整个项目\n\n要求\n保留测试",
    );
    expect(() => formatQuestionAnswers(message.questions, ["整个项目"])).toThrow(
      "Invalid question answers",
    );
    expect(() => formatQuestionAnswers(message.questions, ["整个项目", "  "])).toThrow(
      "Invalid question answers",
    );
  });
  it("restores a persisted steer answer once after its question", () => {
    const answer = {
      id: "native-answer",
      role: "user" as const,
      text: "选择范围\n整个项目\n\n要求\n保留测试",
      type: "message" as const,
    };
    const snapshot: AgentProviderTaskSnapshot = {
      contextUsage: null,
      goal: null,
      id: "task-1",
      pendingRequests: [],
      pinned: false,
      plan: null,
      projectId: "project-1",
      status: "running",
      title: "Task",
      turns: [turn],
      turnsNextCursor: null,
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
    const group = collectQuestionGroups([turn], identity)[0];
    if (group === undefined) throw new Error("Missing question group");
    const record: AsyncQuestionRecord = {
      group: { ...group, status: "answered" },
      result: {
        checkpoint: { sequence: 1, sessionId: "session" },
        input: { attachments: [], skills: [], text: answer.text, type: "prompt" },
        messageId: "persisted-answer",
        question: { ...group, status: "answered" },
        turn: null,
        turnId: turn.id,
      },
    };

    const restored = restoreAsyncQuestionAnswers(snapshot, [record]);
    expect(restored.turns[0]?.items).toEqual([message, { ...answer, id: "persisted-answer" }]);
    const nativeSnapshot = { ...snapshot, turns: [{ ...turn, items: [message, answer] }] };
    expect(restoreAsyncQuestionAnswers(nativeSnapshot, [record])).toBe(nativeSnapshot);
  });
});
