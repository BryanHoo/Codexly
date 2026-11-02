import { expect, test, vi } from "vitest";
import type { LocalTask } from "@codexly/core";
import { createCodexAgentProvider, FakeRpcClient, project } from "./agent-provider.test-support.js";

test("checks application archive state without RPC or archive pagination", async () => {
  let task: LocalTask | null = {
    id: "application-id",
    sessionId: "native-id",
    provider: "codex",
    projectId: project.id,
    title: "归档查询",
    cwd: project.roots[0].path,
    archived: false,
    pinned: false,
    status: "idle",
    updatedAt: 1,
  };
  const client = new FakeRpcClient([]);
  const readLocalTask = vi.fn(() => Promise.resolve(task));
  const provider = createCodexAgentProvider({
    project,
    client: Object.assign(client, { readLocalTask }),
  });
  expect(await provider.isTaskArchived("application-id")).toBe(false);
  task = { ...task, archived: true, pinned: true };
  expect(await provider.isTaskArchived("application-id")).toBe(true);
  task = { ...task, projectId: "foreign" };
  expect(await provider.isTaskArchived("application-id")).toBeUndefined();
  task = { ...task, projectId: project.id, provider: "claude" };
  expect(await provider.isTaskArchived("application-id")).toBeUndefined();
  task = null;
  expect(await provider.isTaskArchived("application-id")).toBeUndefined();
  expect(readLocalTask).toHaveBeenCalledTimes(5);
  expect(readLocalTask).toHaveBeenLastCalledWith("application-id");
  expect(client.calls).toEqual([]);
});
