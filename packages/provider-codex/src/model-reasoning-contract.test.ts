import { describe, expect, it } from "vitest";
import { mapCodexTurnSettings } from "./codex-turn-settings.js";
import { mapAgentModel } from "./codex-protocol-mapping.js";
import { writeRuntimeDefaultSettings } from "./runtime-default-settings.js";
import { FakeRpcClient } from "./provider-connection.test-support.js";

describe("unknown versus explicit reasoning capability", () => {
  it("keeps a non-reasoning native model usable without claiming effort options", () => {
    const model = mapAgentModel({
      model: "plain",
      displayName: "Plain",
      description: "",
      multiAgentVersion: null,
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: "none",
      supportedReasoningEfforts: [],
    });
    expect(model).toMatchObject({ defaultReasoningEffort: "", supportedReasoningEfforts: [] });
  });
  it.each(["", "none", "ultra"])(
    "sends the selected effort %j without inventing a level",
    (reasoningEffort) => {
      const options = {
        model: "custom",
        reasoningEffort,
        approvalPolicy: "on-request" as const,
        approvalsReviewer: "user" as const,
        sandboxMode: "workspace-write" as const,
      };
      const mapped = mapCodexTurnSettings(options);
      expect(mapped.effort).toBe(reasoningEffort || null);
      expect(mapped.collaborationMode.settings.reasoning_effort).toBe(reasoningEffort || null);
    },
  );
  it("clears the native override when saving an unknown effort", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/batchWrite", {});
    await writeRuntimeDefaultSettings(client, { reasoningEffort: "" });
    expect(client.requests[0]?.params).toMatchObject({
      edits: [{ keyPath: "model_reasoning_effort", value: null, mergeStrategy: "replace" }],
    });
  });
});
