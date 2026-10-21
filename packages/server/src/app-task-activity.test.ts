import type { TaskActivitySnapshot, EventCheckpoint } from "@codexly/protocol";
import { expect, test, vi } from "vitest";
interface ActivityEntry extends TaskActivitySnapshot {
  version: number;
  checkpoint: EventCheckpoint;
}
interface ActivityPage {
  data: ActivityEntry[];
}

import { createHarness, task } from "./app-all.test-support.js";

test("restores activity independently of task pages and retains terminal state after event eviction", async () => {
  const { app, emitEvent, readTask, listTasks } = await createHarness();
  await app.inject("/v1/projects/codexly/tasks");
  readTask.mockClear();
  listTasks.mockClear();
  emitEvent({
    type: "turn.started",
    taskId: task.id,
    turnId: "run",
    payload: {
      turn: {
        id: "run",
        status: "running",
        error: null,
        items: [],
        startedAt: "2026-10-21T00:00:00.000Z",
        completedAt: null,
      },
    },
  });
  const running = await app.inject("/v1/tasks/activity");
  expect(running.statusCode).toBe(200);
  expect(running.json<ActivityPage>().data).toEqual([
    expect.objectContaining({ projectId: "codexly", taskId: task.id, status: "running" }),
  ]);
  emitEvent({
    type: "turn.completed",
    taskId: task.id,
    turnId: "run",
    payload: {
      turn: {
        id: "run",
        status: "completed",
        error: null,
        items: [],
        startedAt: "2026-10-21T00:00:00.000Z",
        completedAt: "2026-10-21T00:01:00.000Z",
      },
    },
  });
  for (let i = 0; i < 1100; i += 1)
    emitEvent({ type: "task.metadata_changed", taskId: task.id, payload: { title: "保留状态" } });
  expect((await app.inject("/v1/tasks/activity")).json<ActivityPage>().data).toEqual([
    expect.objectContaining({ taskName: "保留状态", status: "completed" }),
  ]);
  expect(readTask).not.toHaveBeenCalled();
  expect(listTasks).not.toHaveBeenCalled();
});

test("acknowledges only the observed terminal version and pushes activity changes to idle devices", async () => {
  const { app, emitEvent } = await createHarness();
  await app.inject("/v1/projects/codexly/tasks");
  const frames: unknown[] = [];
  const socket = await app.injectWS(
    "/v1/workbench/events",
    { headers: { host: "localhost", origin: "http://localhost" } },
    {
      onInit(ws) {
        ws.on("message", (data: { toString(): string }) =>
          frames.push(JSON.parse(data.toString())),
        );
      },
    },
  );
  const complete = () => {
    emitEvent({
      type: "turn.completed",
      taskId: task.id,
      turnId: "turn",
      payload: {
        turn: {
          id: "turn",
          status: "completed",
          items: [],
          error: null,
          startedAt: null,
          completedAt: null,
        },
      },
    });
  };
  try {
    complete();
    const first = (await app.inject("/v1/tasks/activity")).json<ActivityPage>().data[0];
    if (first === undefined) throw new Error("Missing first activity");
    expect(first.checkpoint.sequence).toBeGreaterThan(0);
    complete();
    const confirm = (version: number) =>
      app.inject({
        method: "POST",
        url: "/v1/tasks/activity/acknowledge",
        payload: { projectId: "codexly", taskId: task.id, version },
      });
    expect((await confirm(first.version)).json()).toEqual({ acknowledged: false });
    const latest = (await app.inject("/v1/tasks/activity")).json<ActivityPage>().data[0];
    if (latest === undefined) throw new Error("Missing latest activity");
    expect((await confirm(latest.version)).json()).toEqual({ acknowledged: true });
    expect((await app.inject("/v1/tasks/activity")).json()).toEqual({ data: [] });
    await vi.waitFor(() => {
      expect(frames).toContainEqual({ type: "task-activity.changed" });
    });
  } finally {
    socket.terminate();
  }
});

test("seeds missing runtime activity from an authoritative detail snapshot", async () => {
  const { app, readTask } = await createHarness();
  const { snapshot } = await import("./app.test-support.js");
  readTask.mockResolvedValueOnce({ ...snapshot, status: "running" });
  expect((await app.inject("/v1/projects/codexly/tasks/task-1")).statusCode).toBe(200);
  expect((await app.inject("/v1/tasks/activity")).json<ActivityPage>().data).toEqual([
    expect.objectContaining({ taskId: "task-1", status: "running" }),
  ]);
});
