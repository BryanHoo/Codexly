import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { AccessSessionController } from "./access-context.js";

function createClient() {
  let unauthorized: (() => void) | undefined;
  return {
    client: {
      getAccessStatus: vi.fn(() =>
        Promise.resolve({ authenticated: true, mode: "local" as const, version: 1 as const }),
      ),
      logoutAccess: vi.fn(() =>
        Promise.resolve({ authenticated: false, mode: "lan" as const, version: 1 as const }),
      ),
      pairAccess: vi.fn(() =>
        Promise.resolve({ authenticated: true, mode: "lan" as const, version: 1 as const }),
      ),
      subscribeUnauthorized: vi.fn((listener: () => void) => {
        unauthorized = listener;
        return () => {
          unauthorized = undefined;
        };
      }),
    },
    unauthorized: () => {
      unauthorized?.();
    },
  };
}

describe("AccessSessionController", () => {
  it("loads access before exposing authenticated application state", async () => {
    const { client } = createClient();
    const controller = new AccessSessionController(client, new QueryClient());

    expect(controller.getSnapshot().loading).toBe(true);
    expect(controller.getSnapshot().status).toBeUndefined();
    controller.start();
    await vi.waitFor(() => {
      expect(controller.getSnapshot().status?.authenticated).toBe(true);
    });
    expect(controller.getSnapshot()).toMatchObject({ loading: false, status: { mode: "local" } });
  });

  it("clears sensitive queries immediately when any request reports 401", async () => {
    const { client, unauthorized } = createClient();
    const queryClient = new QueryClient();
    queryClient.setQueryData(["projects"], { secret: true });
    const controller = new AccessSessionController(client, queryClient);
    controller.start();
    await vi.waitFor(() => {
      expect(controller.getSnapshot().status).toBeDefined();
    });

    unauthorized();

    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      status: { authenticated: false, mode: "lan", version: 1 },
    });
    expect(queryClient.getQueryData(["projects"])).toBeUndefined();
  });

  it("pairs and logs out without storing the pairing code in Query Cache", async () => {
    const { client } = createClient();
    const queryClient = new QueryClient();
    const controller = new AccessSessionController(client, queryClient);

    await controller.pair("one-time-code");
    expect(client.pairAccess).toHaveBeenCalledWith("one-time-code");
    expect(controller.getSnapshot().status?.authenticated).toBe(true);
    expect(queryClient.getQueryCache().getAll()).toEqual([]);

    queryClient.setQueryData(["tasks"], { secret: true });
    await controller.logout();
    expect(controller.getSnapshot().status?.authenticated).toBe(false);
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
});
