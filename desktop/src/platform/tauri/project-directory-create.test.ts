import { expect, it, vi } from "vitest";
import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";

it("creates a child directory through the native command without registering a project", async () => {
  const invoke = vi.fn(async () => ({ path: "/work/demo", status: "created" }));
  const client = new TauriSidebarClient({ ensureRuntime: async () => undefined, invoke: invoke as InvokeImplementation });
  expect(await client.createProjectDirectory({ parentPath: "/work", name: "demo" })).toEqual({ path: "/work/demo", status: "created" });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_project_directory", { parentPath: "/work", name: "demo" });
});
