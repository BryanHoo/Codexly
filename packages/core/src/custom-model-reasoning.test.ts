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
  it("preserves explicit none without inventing reasoning support", () => {
    const page = createModelPage();
    expect(normalizeCustomModelReasoning(page)).toBe(page);
  });

  it("clears the default when reasoning capabilities are unknown", () => {
    const page = createModelPage();
    const model = page.data[0];
    if (model === undefined) throw new Error("Missing model fixture");
    const unknown = { ...page, data: [{ ...model, supportedReasoningEfforts: [] }] };
    expect(normalizeCustomModelReasoning(unknown).data[0]).toMatchObject({
      defaultReasoningEffort: "",
      supportedReasoningEfforts: [],
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
