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
  it("preserves online custom capabilities and persists them unchanged", async () => {
    const repository = createRepository();
    const load = createModelCatalogLoader(
      createProvider("custom", () => Promise.resolve(createNoneOnlyPage())),
      repository,
    );

    const result = await load();

    expect(result.data[0]).toMatchObject({
      defaultReasoningEffort: "none",
      supportedReasoningEfforts: [{ id: "none" }],
    });
    expect(repository.writeProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ customModels: result }),
    );
  });

  it("uses a matching persisted custom catalog after a failed refresh", async () => {
    const repository = createRepository(createNoneOnlyPage());
    const load = createModelCatalogLoader(
      createProvider("custom", () => Promise.reject(new Error("unavailable"))),
      repository,
    );

    await expect(load()).resolves.toMatchObject({
      data: [{ id: "gpt-6-sol", defaultReasoningEffort: "none" }],
    });
    expect(repository.readProviderConnection).toHaveBeenCalledOnce();
    expect(repository.writeProviderConnection).not.toHaveBeenCalled();
  });

  it("uses matching cached models when both live sources return no models", async () => {
    const page = { data: [], nextCursor: null };
    const repository = createRepository(createNoneOnlyPage());
    const load = createModelCatalogLoader(
      createProvider("custom", () => Promise.resolve(page)),
      repository,
    );

    await expect(load()).resolves.toMatchObject({ data: [{ id: "gpt-6-sol" }] });
    expect(repository.writeProviderConnection).not.toHaveBeenCalled();
  });

  it("rejects an unavailable custom catalog without a usable cache", async () => {
    const repository = createRepository();
    const load = createModelCatalogLoader(
      createProvider("custom", () => Promise.resolve({ data: [], nextCursor: null })),
      repository,
    );
    await expect(load()).rejects.toThrow("No Agent models are available");
    expect(repository.writeProviderConnection).not.toHaveBeenCalled();
  });

  it("never uses models cached for another endpoint", async () => {
    const repository = createRepository(createNoneOnlyPage());
    const provider = createProvider("custom", () => Promise.reject(new Error("offline")));
    provider.readProviderConnection.mockResolvedValue({
      account: { type: "apiKey" },
      customBaseUrl: "https://other.example/v1",
      mode: "custom",
      pendingLogin: null,
      state: "connected",
    });
    await expect(createModelCatalogLoader(provider, repository)()).rejects.toThrow("offline");
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
