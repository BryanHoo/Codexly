import { describe, expect, it, vi } from "vitest";

import type { AgentRuntimeProvider } from "@codexly/core";
import type { AgentModelPage } from "@codexly/protocol";

import { resolveReconnectModels } from "./provider-reconnect-models.js";

const cliModels: AgentModelPage = {
  data: [
    {
      defaultReasoningEffort: "medium",
      description: "",
      displayName: "CLI Model",
      id: "cli-model",
      isDefault: true,
      supportedReasoningEfforts: [{ description: "", id: "medium" }],
    },
  ],
  nextCursor: null,
};

function createProvider(listModels: () => Promise<AgentModelPage>) {
  return {
    listModels: vi.fn(listModels),
    readProviderConnection: vi.fn(() =>
      Promise.resolve({
        account: { type: "apiKey" as const },
        customBaseUrl: "https://api.example.com/v1",
        mode: "custom" as const,
        pendingLogin: null,
        state: "connected" as const,
      }),
    ),
  } satisfies Pick<AgentRuntimeProvider, "listModels" | "readProviderConnection">;
}

describe("resolveReconnectModels", () => {
  it("uses the Codex CLI catalog as the first fallback for upstream discovery", async () => {
    const provider = createProvider(() => Promise.resolve(cliModels));

    await expect(
      resolveReconnectModels({ baseUrl: "https://api.example.com/v1" }, provider),
    ).resolves.toEqual(cliModels);
    expect(provider.listModels).toHaveBeenCalledOnce();
  });

  it("keeps reconnect possible without reviving a persisted catalog after failure", async () => {
    const provider = createProvider(() => Promise.reject(new Error("CLI catalog unavailable")));

    await expect(
      resolveReconnectModels({ baseUrl: "https://api.example.com/v1" }, provider),
    ).resolves.toEqual({ data: [], nextCursor: null });
  });

  it("normalizes the Codex CLI none placeholder before reconnecting", async () => {
    const provider = createProvider(() =>
      Promise.resolve({
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
      }),
    );

    await expect(
      resolveReconnectModels({ baseUrl: "https://api.example.com/v1" }, provider),
    ).resolves.toMatchObject({
      data: [
        {
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ id: "low" }, { id: "medium" }, { id: "high" }],
        },
      ],
    });
  });
});
