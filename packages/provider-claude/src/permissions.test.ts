import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { ClaudePermissions } from "./permissions.js";
import type { AgentProviderEvent } from "@codexly/core";

describe("Claude permission lifecycle", () => {
  it("binds decisions to task/turn/tool and only persists SDK suggested session rules", async () => {
    const events: AgentProviderEvent[] = [];
    const broker = new ClaudePermissions("project", "task", "turn", (event) => events.push(event));
    const signal = new AbortController();
    const result = broker.request(
      "Bash",
      { command: "pwd" },
      {
        signal: signal.signal,
        toolUseID: "tool",
        requestId: "request",
        suggestions: [
          {
            type: "addRules",
            rules: [{ toolName: "Bash", ruleContent: "pwd" }],
            behavior: "allow",
            destination: "userSettings",
          },
        ],
      },
    );
    const request = broker.pending()[0];
    assert(request);
    expect(request.type).toBe("tool_approval");
    expect(() =>
      broker.resolve({
        ...request,
        taskId: "other",
        type: "tool_approval",
        resolution: { decision: "allow" },
      }),
    ).toThrow(/mismatch/i);
    broker.resolve({
      ...request,
      type: "tool_approval",
      resolution: { decision: "allow_for_session" },
    });
    expect(await result).toEqual({
      behavior: "allow",
      updatedInput: { command: "pwd" },
      updatedPermissions: [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "pwd" }],
          behavior: "allow",
          destination: "session",
        },
      ],
    });
    expect(broker.pending()).toEqual([]);
    expect(events.at(-1)?.type).toBe("pending_request.resolved");
  });

  it("expires aborted approvals and rejects stale or unsupported session approvals", async () => {
    const broker = new ClaudePermissions("p", "t", "turn", () => undefined);
    const controller = new AbortController();
    const result = broker.request(
      "Read",
      { file_path: "/tmp/a" },
      {
        signal: controller.signal,
        toolUseID: "tool",
        requestId: "request",
        suppressAlwaysAllowRule: true,
      },
    );
    const request = broker.pending()[0];
    assert(request);
    expect(request).toMatchObject({ availableDecisions: ["allow", "deny"] });
    expect(() =>
      broker.resolve({
        ...request,
        type: "tool_approval",
        resolution: { decision: "allow_for_session" },
      }),
    ).toThrow();
    controller.abort();
    expect(await result).toMatchObject({ behavior: "deny", interrupt: true });
    expect(broker.pending()).toEqual([]);
    expect(() =>
      broker.resolve({ ...request, type: "tool_approval", resolution: { decision: "allow" } }),
    ).toThrow();
  });

  it("returns structured AskUserQuestion answers with the original tool input", async () => {
    const broker = new ClaudePermissions("p", "t", "turn", () => undefined);
    const input = {
      questions: [
        {
          header: "部署",
          question: "选择环境",
          options: [
            { label: "测试", description: "隔离环境" },
            { label: "生产", description: "线上环境" },
          ],
        },
      ],
    };
    const result = broker.request("AskUserQuestion", input, {
      signal: new AbortController().signal,
      toolUseID: "tool",
      requestId: "request",
    });
    const request = broker.pending()[0];
    assert(request);
    expect(request.type).toBe("user_input");
    broker.resolve({ ...request, type: "user_input", resolution: { answers: { "0": ["测试"] } } });
    expect(await result).toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { 选择环境: "测试" } },
    });
  });
});

it("supports four Claude questions and preserves multiple selected answers", async () => {
  const broker = new ClaudePermissions("p", "t", "turn", () => undefined);
  const input = {
    questions: Array.from({ length: 4 }, (_, index) => ({
      header: "范围",
      question: `范围 ${String(index)}`,
      multiSelect: true,
      options: [
        { label: "Web", description: "浏览器" },
        { label: "桌面", description: "原生" },
      ],
    })),
  };
  const result = broker.request("AskUserQuestion", input, {
    signal: new AbortController().signal,
    toolUseID: "tool",
    requestId: "request",
  });
  const request = broker.pending()[0];
  assert(request);
  const { Value } = await import("@sinclair/typebox/value");
  const { PendingRequestSchema } = await import("@codexly/protocol");
  expect(Value.Check(PendingRequestSchema, request)).toBe(true);
  broker.resolve({
    ...request,
    type: "user_input",
    resolution: {
      answers: Object.fromEntries(
        input.questions.map((_, index) => [String(index), ["Web", "桌面"]]),
      ),
    },
  });
  expect(await result).toMatchObject({
    updatedInput: { answers: { "范围 0": "Web, 桌面", "范围 3": "Web, 桌面" } },
  });
});
