import { describe, expect, it, vi } from "vitest";

import type { AgentProviderConnectionRepository, AgentRuntimeProvider } from "@code-agent/core";
import type { AgentModelPage } from "@code-agent/protocol";

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
});
