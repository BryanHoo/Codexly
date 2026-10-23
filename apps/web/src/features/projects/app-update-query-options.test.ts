import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { AppInfoResponse } from "@codexly/protocol";

import { appUpdateProgressQueryOptions, refreshAppInfo } from "./app-update-query-options.js";

describe("application update query options", () => {
  it("bypasses both browser and server version caches for an explicit check", async () => {
    const queryClient = new QueryClient();
    const available: AppInfoResponse = {
      appVersion: "0.40.0",
      codexVersion: "0.163.0",
      latestVersion: "0.41.0",
      releaseNotes: null,
      status: "available",
      updateAvailable: true,
    };
    queryClient.setQueryData(["app-info"], {
      ...available,
      latestVersion: "0.40.0",
      status: "current",
      updateAvailable: false,
    });
    const client = {
      getAppInfo: vi.fn().mockResolvedValue(available),
      getAppUpdateProgress: vi.fn(),
      installAppUpdate: vi.fn(),
    };
    try {
      await refreshAppInfo(queryClient, client);
      expect(client.getAppInfo).toHaveBeenCalledWith(expect.objectContaining({ refresh: true }));
      expect(queryClient.getQueryData(["app-info"])).toEqual(available);
    } finally {
      queryClient.clear();
    }
  });
  it("polls progress only while an update is active", () => {
    const client = {
      getAppInfo: vi.fn(),
      getAppUpdateProgress: vi.fn(),
      installAppUpdate: vi.fn(),
    };

    const active = appUpdateProgressQueryOptions(client, true);
    const idle = appUpdateProgressQueryOptions(client, false);

    expect(active.enabled).toBe(true);
    expect(active.refetchInterval).toBe(250);
    expect(idle.enabled).toBe(false);
    expect(idle.refetchInterval).toBe(false);
  });
});
