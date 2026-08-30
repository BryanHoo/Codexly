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
            text: "正在检查。",
            type: "agentMessage",
          },
          {
            delivery: "async",
            id: "final-message",
            phase: "final_answer",
            text: "检查完成。",
            type: "agentMessage",
          },
          {
            delivery: null,
            id: "legacy-message",
            phase: null,
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

  it("rejects missing or invalid 0.151.0 agent message delivery", () => {
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
});
