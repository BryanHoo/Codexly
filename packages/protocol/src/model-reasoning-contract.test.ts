import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { AgentModelSchema, AgentTurnOptionsSchema } from "./index.js";

describe("unknown model capabilities", () => {
  it("accepts a model without declared reasoning capabilities", () => {
    expect(
      Value.Check(AgentModelSchema, {
        id: "plain",
        displayName: "Plain",
        description: "",
        isDefault: true,
        defaultReasoningEffort: "",
        supportedReasoningEfforts: [],
      }),
    ).toBe(true);
  });
  it("accepts provider defaults without an explicit reasoning override", () => {
    expect(
      Value.Check(AgentTurnOptionsSchema, {
        model: "plain",
        reasoningEffort: "",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxMode: "workspace-write",
      }),
    ).toBe(true);
  });
});
