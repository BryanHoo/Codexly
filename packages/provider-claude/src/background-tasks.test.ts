import { expect, it } from "vitest";
import { ClaudeBackgroundTasks } from "./background-tasks.js";

const started = (run_id = "002") => ({
  type: "system",
  subtype: "task_started",
  task_id: "child",
  run_id,
  tool_use_id: `spawn-${run_id}`,
  is_backgrounded: false,
});
const level = (tasks: object[]) => ({ type: "system", subtype: "background_tasks_changed", tasks });

it.each([true, false])(
  "keeps snapshot membership independent of edges (level first: %s)",
  (levelFirst) => {
    const tasks = new ClaudeBackgroundTasks();
    tasks.receive(started());
    const update = {
      type: "system",
      subtype: "task_updated",
      task_id: "child",
      run_id: "002",
      patch: { is_backgrounded: true },
    };
    const snapshot = level([{ task_id: "child", run_id: "002" }]);
    for (const message of levelFirst ? [snapshot, update] : [update, snapshot])
      tasks.receive(message);
    expect(tasks.has("child")).toBe(true);
    expect(tasks.isBackground("spawn-002")).toBe(true);
    const finished = {
      type: "system",
      subtype: "task_notification",
      task_id: "child",
      run_id: "002",
      status: "completed",
    };
    tasks.receive(levelFirst ? level([]) : finished);
    expect(tasks.has("child")).toBe(!levelFirst);
    tasks.receive(levelFirst ? finished : level([]));
    expect(tasks.size).toBe(0);
    tasks.receive(started());
    expect(tasks.size).toBe(0);
  },
);

it("rejects an older run on all task edges and preserves a newer live run", () => {
  const tasks = new ClaudeBackgroundTasks();
  tasks.receive(started("001"));
  tasks.receive(started("002"));
  tasks.receive(level([{ task_id: "child", run_id: "002" }]));
  for (const subtype of ["task_started", "task_updated", "task_progress", "task_notification"]) {
    expect(
      tasks.receive({
        ...started("001"),
        subtype,
        status: "failed",
        patch: { is_backgrounded: false, status: "failed" },
      }),
    ).toBe(false);
  }
  tasks.receive(level([{ task_id: "child", run_id: "001" }]));
  expect(tasks.has("child")).toBe(true);
  expect(tasks.forTool("spawn-002")).toMatchObject({ runId: "002", background: true });
  expect(tasks.forTool("spawn-001")).toBeUndefined();
});

it("uses task IDs for legacy messages and does not mistake foreground progress for promotion", () => {
  const tasks = new ClaudeBackgroundTasks();
  tasks.receive({ ...started(), run_id: undefined });
  tasks.receive({ type: "system", subtype: "task_progress", task_id: "child" });
  expect(tasks.size).toBe(0);
  expect(tasks.isBackground("spawn-002")).toBe(false);
  tasks.receive({
    type: "system",
    subtype: "task_updated",
    task_id: "child",
    patch: { is_backgrounded: true },
  });
  expect(tasks.size).toBe(1);
  tasks.receive({
    type: "system",
    subtype: "task_notification",
    task_id: "child",
    status: "stopped",
  });
  expect(tasks.size).toBe(0);
});

it("preserves background evidence when the level arrives before the foreground start edge", () => {
  const tasks = new ClaudeBackgroundTasks();
  tasks.receive(level([{ task_id: "child", run_id: "002" }]));
  tasks.receive(started());
  tasks.receive(level([]));
  expect(tasks.size).toBe(0);
  expect(tasks.isBackground("spawn-002")).toBe(true);
  expect(tasks.awaitingNotification("spawn-002")).toBe(true);
});
