import type { AgentModelPage } from "@codexly/protocol";
import { describe, expect, it } from "vitest";

import { normalizeCustomModelReasoning } from "./custom-model-reasoning.js";

function createModelPage(): AgentModelPage {
  return {
    data: [
      {
        defaultReasoningEffort: "none",
        description: "",
        displayName: "GPT-6 Sol",
        id: "gpt-6-sol",
        isDefault: true,
        supportedReasoningEfforts: [{ description: "", id: "none" }],
      },
    ],
    nextCursor: null,
  };
}

describe("normalizeCustomModelReasoning", () => {
  it("replaces a missing custom reasoning catalog with low, medium, and high", () => {
    expect(normalizeCustomModelReasoning(createModelPage())).toEqual({
      data: [
        expect.objectContaining({
          defaultReasoningEffort: "medium",
          id: "gpt-6-sol",
          supportedReasoningEfforts: [
            { description: "", id: "low" },
            { description: "", id: "medium" },
            { description: "", id: "high" },
          ],
        }),
      ],
      nextCursor: null,
    });
  });

  it("preserves an explicit custom reasoning catalog", () => {
    const page: AgentModelPage = {
      data: [
        {
          defaultReasoningEffort: "none",
          description: "",
          displayName: "GPT-6 Sol",
          id: "gpt-6-sol",
          isDefault: true,
          supportedReasoningEfforts: [
            { description: "Disabled", id: "none" },
            { description: "Deep", id: "high" },
          ],
        },
      ],
      nextCursor: null,
    };

    expect(normalizeCustomModelReasoning(page)).toBe(page);
  });
});
