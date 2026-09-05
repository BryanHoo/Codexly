import { describe, expect, it } from "vitest";
import {
  CodexProtocolMappingError,
  mapAgentTurn,
  mapAgentModel,
  mapSandboxMode,
} from "./codex-protocol-mapping.js";
import "./codex-protocol-mapping.test-support.js";

describe("Codex model and message mapping", () => {
  it("maps supported sandbox modes and rejects unknown values", () => {
    expect(mapSandboxMode("read-only")).toBe("read-only");
    expect(mapSandboxMode("workspace-write")).toBe("workspace-write");
    expect(mapSandboxMode("danger-full-access")).toBe("danger-full-access");
    expect(() => mapSandboxMode("legacy-mode")).toThrow(CodexProtocolMappingError);
  });

  it("filters hidden models while preserving the supported effort catalog", () => {
    expect(
      mapAgentModel({
        defaultReasoningEffort: "high",
        description: "Test model",
        displayName: "GPT Test",
        hidden: false,
        isDefault: true,
        model: "gpt-test",
        multiAgentVersion: "v1",
        supportedReasoningEfforts: [{ description: "Deep reasoning", reasoningEffort: "high" }],
      }),
    ).toMatchObject({
      defaultReasoningEffort: "high",
      displayName: "GPT Test",
      id: "gpt-test",
      isDefault: true,
    });
    expect(mapAgentModel({ hidden: true, multiAgentVersion: "disabled" })).toBeUndefined();
  });

  it("preserves documented agent message phases and omits a null legacy phase", () => {
    expect(
      mapAgentTurn({
        completedAt: 1_753_228_830,
        error: null,
        id: "message-phase-turn",
        items: [
          {
            delivery: null,
            id: "commentary-message",
            phase: "commentary",
            questions: null,
            text: "正在检查。",
            type: "agentMessage",
          },
          {
            delivery: "async",
            id: "final-message",
            phase: "final_answer",
            questions: [{ options: ["继续"], title: "是否继续？" }],
            text: "检查完成。",
            type: "agentMessage",
          },
          {
            delivery: null,
            id: "legacy-message",
            phase: null,
            questions: null,
            text: "旧版消息。",
            type: "agentMessage",
          },
        ],
        startedAt: 1_753_228_800,
        status: "completed",
      }).items,
    ).toEqual([
      {
        id: "commentary-message",
        phase: "commentary",
        role: "assistant",
        text: "正在检查。",
        type: "message",
      },
      {
        id: "final-message",
        phase: "final_answer",
        role: "assistant",
        text: "检查完成。",
        type: "message",
      },
      {
        id: "legacy-message",
        role: "assistant",
        text: "旧版消息。",
        type: "message",
      },
    ]);
  });

  it("rejects missing or invalid 0.153.4 agent message delivery", () => {
    const mapMessage = (delivery?: unknown) =>
      mapAgentTurn({
        completedAt: 1_753_228_830,
        error: null,
        id: "message-delivery-turn",
        items: [
          {
            ...(delivery === undefined ? {} : { delivery }),
            id: "message-delivery",
            phase: "final_answer",
            questions: null,
            text: "检查完成。",
            type: "agentMessage",
          },
        ],
        startedAt: 1_753_228_800,
        status: "completed",
      });

    expect(() => mapMessage()).toThrow("Codex agent message delivery must be async or null");
    expect(() => mapMessage("inline")).toThrow(
      "Codex agent message delivery must be async or null",
    );
  });

  it("rejects missing or invalid 0.153.4 asynchronous user input questions", () => {
    const mapMessage = (questions?: unknown) =>
      mapAgentTurn({
        completedAt: 1_753_228_830,
        error: null,
        id: "message-questions-turn",
        items: [
          {
            delivery: null,
            id: "message-questions",
            phase: "final_answer",
            ...(questions === undefined ? {} : { questions }),
            text: "请选择后续操作。",
            type: "agentMessage",
          },
        ],
        startedAt: 1_753_228_800,
        status: "completed",
      });

    expect(() => mapMessage()).toThrow("Codex agent message questions must be an array or null");
    expect(() => mapMessage([{ options: [42], title: "是否继续？" }])).toThrow(
      "Codex asynchronous user input question options must contain only strings",
    );
  });
});
