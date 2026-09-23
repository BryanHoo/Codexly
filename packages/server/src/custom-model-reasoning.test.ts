import type { AgentProviderConnectionRepository, AgentRuntimeProvider } from "@codexly/core";
import type { AgentModelPage, ConfigureCustomProviderResponse } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";

import { createModelCatalogLoader } from "./server-runtime.js";

function createNoneOnlyPage(): ConfigureCustomProviderResponse["models"] {
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

function createRepository(
  storedModels: ConfigureCustomProviderResponse["models"] | null = null,
  mode: "custom" | "official" = "custom",
): Pick<AgentProviderConnectionRepository, "readProviderConnection" | "writeProviderConnection"> {
  return {
    readProviderConnection: vi.fn(() =>
      Promise.resolve({
        customBaseUrl: mode === "custom" ? "https://api.example.test/v1" : null,
        customModels: storedModels,
        mode,
        updatedAt: "2026-09-23T00:00:00.000Z",
      }),
    ),
    writeProviderConnection: vi.fn((record) => Promise.resolve(record)),
  };
}

function createProvider(mode: "custom" | "official", listModels: () => Promise<AgentModelPage>) {
  return {
    listModels: vi.fn(listModels),
    readProviderConnection: vi.fn(() =>
      Promise.resolve({
        account: { type: "apiKey" as const },
        customBaseUrl: mode === "custom" ? "https://api.example.test/v1" : null,
        mode,
        pendingLogin: null,
        state: "connected" as const,
      }),
    ),
  } satisfies Pick<AgentRuntimeProvider, "listModels" | "readProviderConnection">;
}

describe("custom model reasoning fallback", () => {
  it("normalizes online custom models and persists the normalized catalog", async () => {
    const repository = createRepository();
    const load = createModelCatalogLoader(
      createProvider("custom", () => Promise.resolve(createNoneOnlyPage())),
      repository,
    );

    const result = await load();

    expect(result.data[0]).toMatchObject({
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [{ id: "low" }, { id: "medium" }, { id: "high" }],
    });
    expect(repository.writeProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ customModels: result }),
    );
  });

  it("normalizes a matching persisted custom catalog after online failure", async () => {
    const load = createModelCatalogLoader(
      createProvider("custom", () => Promise.reject(new Error("unavailable"))),
      createRepository(createNoneOnlyPage()),
    );

    await expect(load()).resolves.toMatchObject({
      data: [
        {
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ id: "low" }, { id: "medium" }, { id: "high" }],
        },
      ],
    });
  });

  it("preserves an official model that explicitly supports only none", async () => {
    const page = createNoneOnlyPage();
    const repository = createRepository(null, "official");
    const load = createModelCatalogLoader(
      createProvider("official", () => Promise.resolve(page)),
      repository,
    );

    await expect(load()).resolves.toEqual(page);
  });
});
