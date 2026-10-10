import { expect, it, vi } from "vitest";
import { TauriWorkspaceClient } from "./workspace-client.js";
it("uses scoped native commands for text reads and conditional saves", async () => {
  const invoke = vi.fn().mockResolvedValue({version: "a".repeat(64)});
  const client = new TauriWorkspaceClient({invoke, ensureRuntime: () => Promise.resolve()});
  await client.readProjectTextFile("p", "/root", "a.md");
  const input = {path: "a.md", content: "new", expectedVersion: "a".repeat(64)};
  await client.saveProjectTextFile("p", "/root", input);
  expect(invoke).toHaveBeenNthCalledWith(1, "read_project_text_file", {projectId: "p", rootPath: "/root", path: "a.md"});
  expect(invoke).toHaveBeenNthCalledWith(2, "save_project_text_file", {projectId: "p", rootPath: "/root", input});
});
