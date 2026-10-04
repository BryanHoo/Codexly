import { expect, it, vi } from "vitest";
import { TauriCatalogClient } from "./catalog-client.js";
import type { InvokeImplementation } from "./native-client.js";

it("submits history compression through native IPC without local file access", async () => {
  const invoke = vi.fn(async () => ({ status: "scheduled" }));
  const client = new TauriCatalogClient({ ensureRuntime: vi.fn(async () => undefined), invoke: invoke as InvokeImplementation });
  expect(await client.compressHistory()).toEqual({ status: "scheduled" });
  expect(invoke.mock.calls).toEqual([["compress_history"]]);
});
