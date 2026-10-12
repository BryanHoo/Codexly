import { describe, expect, it, vi } from "vitest";
import type { AgentProviderConnectionRepository } from "@codexly/core";
import type { ConfigureCustomProviderResponse } from "@codexly/protocol";
import { resolveReconnectModels } from "./provider-reconnect-models.js";

const models: ConfigureCustomProviderResponse["models"] = {
  data: [
    {
      id: "cached-model",
      displayName: "Cached Model",
      description: "",
      isDefault: true,
      defaultReasoningEffort: "none",
      supportedReasoningEfforts: [{ id: "none", description: "" }],
    },
  ],
  nextCursor: null,
};

function repository(
  page: ConfigureCustomProviderResponse["models"] | null = models,
  baseUrl = "https://api.example.com/v1",
) {
  return {
    readProviderConnection: vi.fn(() =>
      Promise.resolve({
        mode: "custom" as const,
        customBaseUrl: baseUrl,
        customModels: page,
        updatedAt: "2026-10-12T00:00:00Z",
      }),
    ),
  } satisfies Pick<AgentProviderConnectionRepository, "readProviderConnection">;
}

describe("resolveReconnectModels", () => {
  it("provides the matching cache as the last fallback and normalizes reasoning", async () => {
    await expect(
      resolveReconnectModels({ baseUrl: "https://api.example.com/v1/" }, repository()),
    ).resolves.toMatchObject({
      data: [
        {
          id: "cached-model",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ id: "low" }, { id: "medium" }, { id: "high" }],
        },
      ],
    });
  });
  it("does not use another endpoint's models", async () => {
    await expect(
      resolveReconnectModels({ baseUrl: "https://other.example/v1" }, repository()),
    ).resolves.toBeUndefined();
  });
  it.each([null, { data: [], nextCursor: null }])(
    "does not offer an empty or absent cache",
    async (page) => {
      await expect(
        resolveReconnectModels({ baseUrl: "https://api.example.com/v1" }, repository(page)),
      ).resolves.toBeUndefined();
    },
  );
  it("does not read fallback storage for explicit manual models", async () => {
    const store = repository();
    await expect(
      resolveReconnectModels(
        { baseUrl: "https://api.example.com/v1", models: [{ id: "manual", name: "Manual" }] },
        store,
      ),
    ).resolves.toBeUndefined();
    expect(store.readProviderConnection).not.toHaveBeenCalled();
  });
});
