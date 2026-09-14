import { describe, expect, it, vi } from "vitest";

import type { AgentProviderConnectionRepository, AgentRuntimeProvider } from "@codexly/core";
import type { AgentModelPage, AgentProviderConnectionRecord } from "@codexly/protocol";

import { createModelCatalogLoader } from "./server-runtime.js";

describe("createModelCatalogLoader", () => {
  it("uses the active Codex CLI provider catalog instead of stale app-managed models", async () => {
    const cliModels: AgentModelPage = {
      data: [
        {
          defaultReasoningEffort: "medium",
          description: "",
          displayName: "cli-model",
          id: "cli-model",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "", id: "medium" }],
        },
      ],
      nextCursor: null,
    };
    const provider = {
      listModels: vi.fn(() => Promise.resolve(cliModels)),
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          account: { type: "apiKey" as const },
          customBaseUrl: "https://cli.example.test/v1",
          mode: "custom" as const,
          pendingLogin: null,
          state: "connected" as const,
        }),
      ),
    } satisfies Pick<AgentRuntimeProvider, "listModels" | "readProviderConnection">;
    const repository = {
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          customBaseUrl: "https://old.example.test/v1",
          customModels: { data: [], nextCursor: null },
          mode: "custom" as const,
          updatedAt: "2026-08-07T00:00:00.000Z",
        }),
      ),
    } satisfies Pick<AgentProviderConnectionRepository, "readProviderConnection">;

    const load = createModelCatalogLoader(provider, repository);

    await expect(load()).resolves.toEqual(cliModels);
    expect(provider.listModels).toHaveBeenCalledOnce();
  });

  it("merges newly available runtime models into the persisted custom catalog", async () => {
    const runtimeModels: AgentModelPage = {
      data: [
        {
          defaultReasoningEffort: "low",
          description: "Latest model",
          displayName: "GPT-6-Astra",
          id: "gpt-6-astra",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "Fast", id: "low" }],
        },
        {
          defaultReasoningEffort: "medium",
          description: "Updated model metadata",
          displayName: "GPT-5.6-Sol",
          id: "gpt-5.6-sol",
          isDefault: false,
          supportedReasoningEfforts: [{ description: "Balanced", id: "medium" }],
        },
      ],
      nextCursor: null,
    };
    const persistedModels = {
      data: [
        {
          defaultReasoningEffort: "low",
          description: "Stale model metadata",
          displayName: "GPT-5.6 Sol",
          id: "gpt-5.6-sol",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "Fast", id: "low" }],
        },
        {
          defaultReasoningEffort: "medium",
          description: "",
          displayName: "Manual Model",
          id: "manual-model",
          isDefault: false,
          supportedReasoningEfforts: [{ description: "", id: "medium" }],
        },
      ],
      nextCursor: null,
    } satisfies NonNullable<AgentProviderConnectionRecord["customModels"]>;
    const provider = {
      listModels: vi.fn(() => Promise.resolve(runtimeModels)),
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          account: { type: "apiKey" as const },
          customBaseUrl: "https://api.example.test/v1",
          mode: "custom" as const,
          pendingLogin: null,
          state: "connected" as const,
        }),
      ),
    } satisfies Pick<AgentRuntimeProvider, "listModels" | "readProviderConnection">;
    const repository = {
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          customBaseUrl: "https://api.example.test/v1",
          customModels: persistedModels,
          mode: "custom" as const,
          updatedAt: "2026-09-14T00:00:00.000Z",
        }),
      ),
    } satisfies Pick<AgentProviderConnectionRepository, "readProviderConnection">;

    const load = createModelCatalogLoader(provider, repository);

    await expect(load()).resolves.toEqual({
      data: [...runtimeModels.data, persistedModels.data[1]],
      nextCursor: null,
    });
    expect(provider.listModels).toHaveBeenCalledOnce();
  });

  it("falls back to the persisted custom catalog when the runtime catalog is unavailable", async () => {
    const persistedModels = {
      data: [
        {
          defaultReasoningEffort: "medium",
          description: "",
          displayName: "Manual Model",
          id: "manual-model",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "", id: "medium" }],
        },
      ],
      nextCursor: null,
    } satisfies NonNullable<AgentProviderConnectionRecord["customModels"]>;
    const provider = {
      listModels: vi.fn(() => Promise.reject(new Error("catalog unavailable"))),
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          account: { type: "apiKey" as const },
          customBaseUrl: "https://api.example.test/v1",
          mode: "custom" as const,
          pendingLogin: null,
          state: "connected" as const,
        }),
      ),
    } satisfies Pick<AgentRuntimeProvider, "listModels" | "readProviderConnection">;
    const repository = {
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          customBaseUrl: "https://api.example.test/v1",
          customModels: persistedModels,
          mode: "custom" as const,
          updatedAt: "2026-09-14T00:00:00.000Z",
        }),
      ),
    } satisfies Pick<AgentProviderConnectionRepository, "readProviderConnection">;

    const load = createModelCatalogLoader(provider, repository);

    await expect(load()).resolves.toEqual(persistedModels);
  });
});
