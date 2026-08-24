import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  configureCustomProvider,
  providerConnectionQueryOptions,
  providerConnectionRefetchInterval,
  startOfficialProviderLoginMutationOptions,
} from "./provider-connection-queries.js";

const pendingStatus = {
  account: null,
  customBaseUrl: null,
  mode: "official" as const,
  pendingLogin: { error: null, loginId: "login-1", state: "pending" as const },
  state: "pending" as const,
};

describe("provider connection queries", () => {
  it("polls only while an official login is pending", () => {
    const client = { getProviderConnection: vi.fn(() => Promise.resolve(pendingStatus)) };
    const options = providerConnectionQueryOptions(client);
    expect(options.queryKey).toEqual(["provider-connection"]);
    expect(providerConnectionRefetchInterval(pendingStatus)).toBe(1_000);
    expect(
      providerConnectionRefetchInterval({
        ...pendingStatus,
        pendingLogin: null,
        state: "connected",
      }),
    ).toBe(false);
  });

  it("keeps a custom API key out of TanStack query and mutation caches", async () => {
    const queryClient = new QueryClient();
    const configure = vi.fn(() =>
      Promise.resolve({
        models: { data: [], nextCursor: null },
        status: {
          account: { type: "apiKey" as const },
          customBaseUrl: "https://api.example.com/v1",
          mode: "custom" as const,
          pendingLogin: null,
          state: "connected" as const,
        },
      }),
    );

    await configureCustomProvider(
      { apiKey: "custom-secret", baseUrl: "https://api.example.com/v1" },
      queryClient,
      { configureCustomProvider: configure },
    );

    expect(configure).toHaveBeenCalledOnce();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain("custom-secret");
  });

  it("uses a stable mutation key and invalidates dependent reads after login starts", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const startOfficialProviderLogin = vi.fn(() =>
      Promise.resolve({
        authUrl: "https://auth.openai.com/authorize",
        loginId: "login-1",
        status: pendingStatus,
      }),
    );
    const options = startOfficialProviderLoginMutationOptions(queryClient, {
      startOfficialProviderLogin,
    });

    await queryClient.getMutationCache().build(queryClient, options).execute(undefined);

    expect(options.mutationKey).toEqual(["provider-connection", "official-login"]);
    expect(invalidateQueries).toHaveBeenCalledWith({
      exact: true,
      queryKey: ["provider-connection"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ exact: true, queryKey: ["models"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ exact: true, queryKey: ["settings"] });
  });
});
