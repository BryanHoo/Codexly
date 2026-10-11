import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import type { WorkbenchChange } from "@codexly/protocol";
import { installWorkbenchQuerySync } from "./workbench-query-sync.js";

function createVisibilityTarget() {
  const state: { visibilityState: DocumentVisibilityState } = { visibilityState: "visible" };
  return Object.assign(new EventTarget(), state);
}

test("push refreshes only its resource, pauses hidden reads and catches up on visibility and reconnect", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const document = createVisibilityTarget();
  let onChange: (change: WorkbenchChange) => void = () => undefined;
  const unsubscribe = vi.fn();
  const dispose = installWorkbenchQuerySync(
    queryClient,
    {
      subscribeWorkbenchChanges: (listener) => {
        onChange = listener;
        return unsubscribe;
      },
    },
    document,
  );
  const reads = [
    vi.fn(() => Promise.resolve({ data: [] })),
    vi.fn(() => Promise.resolve({ data: [] })),
    vi.fn(() => Promise.resolve({ data: [] })),
  ] as const;
  const keys = [
    ["projects", "project-a", "todos"],
    ["async-questions", "project-a", "task-a"],
    ["projects", "project-b", "todos"],
    ["projects", "project-a", "todos"],
  ];
  const observers = keys.map(
    (queryKey, index) =>
      new QueryObserver(queryClient, { queryKey, queryFn: reads[index] ?? reads[0] }),
  );
  const cleanups = observers.map((observer) => observer.subscribe(() => undefined));
  const settled = () =>
    vi.waitFor(() => {
      observers.forEach((observer) => {
        expect(observer.getCurrentResult().fetchStatus).toBe("idle");
      });
    });
  try {
    await settled();
    reads.forEach((read) => {
      expect(read).toHaveBeenCalledOnce();
    });
    onChange({ type: "project-todos.changed", projectId: "project-a" });
    await vi.waitFor(() => {
      expect(reads[0]).toHaveBeenCalledTimes(2);
    });
    expect(reads[1]).toHaveBeenCalledOnce();
    expect(reads[2]).toHaveBeenCalledOnce();
    document.visibilityState = "hidden";
    onChange({ type: "async-questions.changed", projectId: "project-a", taskId: "task-a" });
    expect(reads[1]).toHaveBeenCalledOnce();
    expect(
      queryClient.getQueryState(["async-questions", "project-a", "task-a"])?.isInvalidated,
    ).toBe(true);
    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => {
      expect(reads[1]).toHaveBeenCalledTimes(2);
    });
    await settled();
    onChange({ type: "workbench.ready" });
    await vi.waitFor(() => {
      expect(reads[1]).toHaveBeenCalledTimes(3);
    });
  } finally {
    dispose();
    cleanups.forEach((cleanup) => {
      cleanup();
    });
    observers.forEach((observer) => {
      observer.destroy();
    });
    queryClient.clear();
  }
  expect(unsubscribe).toHaveBeenCalledOnce();
  document.dispatchEvent(new Event("visibilitychange"));
  expect(reads[1]).toHaveBeenCalledTimes(3);
});

test("a change during an in-flight read causes one follow-up without cancelling the shared request", async () => {
  const queryClient = new QueryClient();
  const target = createVisibilityTarget();
  let onChange: (change: WorkbenchChange) => void = () => undefined;
  const dispose = installWorkbenchQuerySync(
    queryClient,
    {
      subscribeWorkbenchChanges: (listener) => {
        onChange = listener;
        return () => undefined;
      },
    },
    target,
  );
  const read = vi.fn(() => Promise.resolve({ data: ["initial"] }));
  const observer = new QueryObserver(queryClient, {
    queryKey: ["projects", "project-a", "todos"],
    queryFn: read,
  });
  const cleanup = observer.subscribe(() => undefined);
  try {
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().fetchStatus).toBe("idle");
    });
    let resolve: (value: { data: string[] }) => void = () => undefined;
    read.mockImplementationOnce(
      () =>
        new Promise((accept) => {
          resolve = accept;
        }),
    );
    read.mockResolvedValue({ data: ["changed"] });
    const current = observer.refetch();
    onChange({ type: "project-todos.changed", projectId: "project-a" });
    onChange({ type: "project-todos.changed", projectId: "project-a" });
    expect(read).toHaveBeenCalledTimes(2);
    resolve({ data: ["old snapshot"] });
    await current;
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().data).toEqual({ data: ["changed"] });
    });
    expect(read).toHaveBeenCalledTimes(3);
  } finally {
    dispose();
    cleanup();
    observer.destroy();
    queryClient.clear();
  }
});
