import { describe, expect, it, vi } from "vitest";

import { appUpdateProgressQueryOptions } from "./app-update-query-options.js";

describe("application update query options", () => {
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
