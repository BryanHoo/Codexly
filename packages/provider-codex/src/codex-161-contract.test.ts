import { describe, expect, it } from "vitest";
import { hasCurrentCustomModelCatalog } from "./provider-connection-config.js";
import { mapAgentModel } from "./codex-protocol-mapping.js";
import { mapNotification } from "./codex-protocol-mapping.test-support.js";

describe("Codex 0.161 protocol contract", () => {
  it("uses default API-key discovery and recognizes an explicit opt-out", () => {
    const config = {
      model_provider: "custom",
      model_providers: {
        custom: {
          base_url: "https://provider.example/v1",
          model_catalog_url: "https://provider.example/v1/models",
        },
      },
    };
    expect(hasCurrentCustomModelCatalog(config)).toBe(true);
    expect(
      hasCurrentCustomModelCatalog({ ...config, features: { api_key_model_discovery: false } }),
    ).toBe(false);
  });
  it.each(["futureError", { futureError: { detail: "unknown", retryAfterSeconds: 30 } }])(
    "keeps unknown error variants visible without forwarding opaque payloads: %j",
    (codexErrorInfo) => {
      const event = mapNotification("error", {
        error: { codexErrorInfo, message: "请求失败" },
        threadId: "task-1",
        turnId: "turn-1",
        willRetry: true,
      });
      expect(event).toMatchObject({
        payload: { code: "other", message: "请求失败", willRetry: true },
        type: "provider.error",
      });
      expect(event?.payload).not.toHaveProperty("codexErrorInfo");
    },
  );

  it("uses the server model default and preserves Ultra reasoning", () => {
    const model = mapAgentModel({
      defaultReasoningEffort: "high",
      description: "Coding model",
      displayName: "GPT-6.1 Sol",
      hidden: false,
      id: "gpt-6.1-sol",
      isDefault: true,
      model: "gpt-6.1-sol",
      multiAgentVersion: "v2",
      supportedReasoningEfforts: [
        { description: "High", reasoningEffort: "high" },
        { description: "Ultra", reasoningEffort: "ultra" },
      ],
    });
    expect(model).toMatchObject({
      id: "gpt-6.1-sol",
      isDefault: true,
      supportedReasoningEfforts: [{ id: "high" }, { id: "ultra" }],
    });
  });
});
