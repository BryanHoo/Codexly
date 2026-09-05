import { describe, expect, it } from "vitest";

import { mapAgentTask } from "./codex-protocol-mapping.js";
import { nativeThread, projectTaskScope } from "./agent-provider.test-support.js";

describe("Codex thread mapping", () => {
  it("exposes actual nullable thread configuration", async () => {
    for (const configuration of [
      { model: "cli-model", reasoningEffort: "high" },
      { model: null, reasoningEffort: null },
    ]) {
      await expect(
        mapAgentTask(nativeThread(configuration), projectTaskScope),
      ).resolves.toMatchObject({
        threadConfiguration: configuration,
      });
    }
  });
  it("requires the 0.153.4 nullable native model settings", async () => {
    await expect(
      mapAgentTask(nativeThread({ model: undefined }), projectTaskScope),
    ).rejects.toThrow("Codex thread model must be a string or null");
    await expect(
      mapAgentTask(nativeThread({ reasoningEffort: 42 }), projectTaskScope),
    ).rejects.toThrow("Codex thread reasoningEffort must be a string or null");
  });
});
