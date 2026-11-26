import Database from "better-sqlite3";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
import { createScheduledTask } from "./scheduled-task-runtime.js";
import { turnOptions } from "./app-all.test-support.js";

it("计划删除与 ACP 配置回收共用事务，失败保留两者并隔离其他来源", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const task = await createScheduledTask(
    "remove",
    {
      enabled: false,
      name: "Plan",
      projectId: "p",
      projectName: "P",
      prompt: { type: "prompt", text: "review", attachments: [], skills: [] },
      messageAttachments: [],
      schedule: { type: "once", atUnixMs: 2_000_000_000_000 },
      turnOptions,
    },
    1,
  );
  await store.replaceScheduledTasks([task]);
  for (const [source, scheduleId] of [
    ["web", "remove"],
    ["desktop", "remove"],
    ["web", "future"],
  ] as const)
    await store.catalog("acp.schedule.set", {
      source,
      scheduleId,
      engine: "codex",
      values: { mode: false },
      expectedRevision: 0,
    });
  const db = new Database(join(root, "state.sqlite3"));
  try {
    const version = db.pragma("user_version", { simple: true });
    db.exec(
      "CREATE TRIGGER prevent_config_delete BEFORE DELETE ON acp_scheduled_configs BEGIN SELECT RAISE(ABORT,'blocked cleanup'); END",
    );
    await expect(store.replaceScheduledTasks([])).rejects.toThrow("blocked cleanup");
    expect(await store.listScheduledTasks()).toEqual([task]);
    expect(
      await store.catalog("acp.schedule.read", { source: "web", scheduleId: "remove" }),
    ).toMatchObject({ revision: 1 });
    db.exec("DROP TRIGGER prevent_config_delete");
    db.exec(
      "CREATE TRIGGER prevent_plan_write BEFORE UPDATE ON scheduled_task_state BEGIN SELECT RAISE(ABORT,'blocked snapshot'); END",
    );
    await expect(store.replaceScheduledTasks([])).rejects.toThrow("blocked snapshot");
    expect(
      await store.catalog("acp.schedule.read", { source: "web", scheduleId: "remove" }),
    ).toMatchObject({ revision: 1 });
    expect(await store.listScheduledTasks()).toEqual([task]);
    db.exec("DROP TRIGGER prevent_plan_write");
    await store.replaceScheduledTasks([]);
    expect(
      await store.catalog("acp.schedule.read", { source: "web", scheduleId: "remove" }),
    ).toBeNull();
    expect(
      await store.catalog("acp.schedule.read", { source: "desktop", scheduleId: "remove" }),
    ).toMatchObject({ revision: 1 });
    expect(
      await store.catalog("acp.schedule.read", { source: "web", scheduleId: "future" }),
    ).toMatchObject({ revision: 1 });
    expect(db.pragma("user_version", { simple: true })).toBe(version);
  } finally {
    db.close();
  }
});
