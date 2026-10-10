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

it("checks native metadata revisions without reading full text", async () => {
  const invoke = vi.fn().mockResolvedValue({revision:"b".repeat(64)});
  const client = new TauriWorkspaceClient({invoke, ensureRuntime:()=>Promise.resolve()});
  expect(await client.readProjectTextFileRevision("p", "/root", "a.md")).toEqual({revision:"b".repeat(64)});
  expect(invoke).toHaveBeenCalledWith("read_project_text_file_revision", {projectId:"p",rootPath:"/root",path:"a.md"});
});

it("does not start a native text read if aborted while waiting for runtime readiness", async () => {
  const invoke = vi.fn();
  let resolve!: () => void;
  const client = new TauriWorkspaceClient({invoke, ensureRuntime:()=>new Promise<void>(done=>{resolve=done;})});
  const controller = new AbortController();
  const reading = client.readProjectTextFile("p", "/root", "a.md", {signal:controller.signal});
  controller.abort();
  resolve();
  await expect(reading).rejects.toMatchObject({name:"AbortError"});
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects already aborted reads and ignores an aborted in-flight result", async () => {
  const controller = new AbortController();
  const invoke = vi.fn().mockImplementation(async () => { controller.abort(); return {}; });
  const client = new TauriWorkspaceClient({invoke, ensureRuntime:()=>Promise.resolve()});
  await expect(client.readProjectTextFile("p", "/root", "a.md", {signal:controller.signal})).rejects.toMatchObject({name:"AbortError"});
  await expect(client.readProjectTextFileRevision("p", "/root", "a.md", {signal:controller.signal})).rejects.toMatchObject({name:"AbortError"});
  expect(invoke).toHaveBeenCalledTimes(1);
});
