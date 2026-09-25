import type { AgentTask } from "@/protocol/index.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  refreshTaskSnapshot: vi.fn(async () => undefined),
  restoreTaskActivities: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../../platform/tauri/task-activity-client.js", () => ({ getTaskActivities: async () => [] }));
vi.mock("../../projects/project-context.js", () => ({ useProjectActions: () => ({ projectRuntime: mocks }) }));

import { TaskActivityRestore } from "./task-activity-restore.js";

it.each(["project-a", "temporary"])("inserts a native scheduled run without an existing project subscription: %s", async (projectId) => {
  const queryClient = new QueryClient();
  const unlisten = vi.fn();
  let receive: ((event: { payload: AgentTask }) => void) | undefined;
  mocks.listen.mockImplementation((_name, callback) => {
    receive = callback;
    return Promise.resolve(unlisten);
  });
  const key = ["projects", projectId, "tasks"];
  queryClient.setQueryData(key, { pageParams: [undefined], pages: [{ data: [], nextCursor: null }] });
  const screen = await render(<QueryClientProvider client={queryClient}><TaskActivityRestore /></QueryClientProvider>);
  await expect.poll(() => receive).toBeDefined();
  expect(mocks.listen).toHaveBeenCalledWith("scheduled-task://started", expect.any(Function));
  const task: AgentTask = { id: "scheduled-run", projectId, title: "每日巡检", pinned: false, updatedAt: "2030-01-01T00:00:00Z" };
  receive!({ payload: task });
  await expect.poll(() => queryClient.getQueryData(key)).toEqual({
    pageParams: [undefined], pages: [{ data: [task], nextCursor: null }],
  });
  await expect.poll(() => mocks.refreshTaskSnapshot.mock.calls).toContainEqual([projectId, task.id]);
  await screen.unmount();
  expect(unlisten).toHaveBeenCalledOnce();
  queryClient.clear();
});

it("releases a listener that finishes registering after unmount", async () => {
  const queryClient = new QueryClient();
  const unlisten = vi.fn();
  let finishRegistration: ((cleanup: () => void) => void) | undefined;
  mocks.listen.mockImplementation(() => new Promise<() => void>((resolve) => { finishRegistration = resolve; }));
  const screen = await render(<QueryClientProvider client={queryClient}><TaskActivityRestore /></QueryClientProvider>);
  await expect.poll(() => finishRegistration).toBeDefined();
  await screen.unmount();
  finishRegistration!(unlisten);
  await expect.poll(() => unlisten.mock.calls.length).toBe(1);
  queryClient.clear();
});
