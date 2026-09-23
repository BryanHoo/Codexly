import { describe, expect, it, vi } from "vitest";

import type { AgentProviderConnectionRepository, AgentRuntimeProvider } from "@codexly/core";
import type { AgentModelPage, AgentProviderConnectionRecord } from "@codexly/protocol";

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

const persistedModels: NonNullable<AgentProviderConnectionRecord["customModels"]> = {
  data: [
    {
      defaultReasoningEffort: "medium",
      description: "",
      displayName: "Persisted Model",
      id: "persisted-model",
      isDefault: true,
      supportedReasoningEfforts: [{ description: "", id: "medium" }],
    },
  ],
  nextCursor: null,
};

function createRepository() {
  return {
    readProviderConnection: vi.fn(() =>
      Promise.resolve({
        customBaseUrl: "https://api.example.com/v1",
        customModels: persistedModels,
        mode: "custom" as const,
        updatedAt: "2026-09-23T00:00:00.000Z",
      }),
    ),
  } satisfies Pick<AgentProviderConnectionRepository, "readProviderConnection">;
}

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
      resolveReconnectModels(
        { baseUrl: "https://api.example.com/v1" },
        provider,
        createRepository(),
      ),
    ).resolves.toEqual(cliModels);
    expect(provider.listModels).toHaveBeenCalledOnce();
  });

  it("uses the persisted catalog only when the Codex CLI catalog is unavailable", async () => {
    const provider = createProvider(() => Promise.reject(new Error("CLI catalog unavailable")));

    await expect(
      resolveReconnectModels(
        { baseUrl: "https://api.example.com/v1" },
        provider,
        createRepository(),
      ),
    ).resolves.toEqual(persistedModels);
  });
});
