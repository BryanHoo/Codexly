import Database from "better-sqlite3";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
import type { TaskSubmissionRecord } from "@codexly/core";

it("SQLite 恢复原子转交原任务，竞争请求不能重复取得且旧记录形状不变", async () => {
  const root = await createWorkspace();
  const repo = await openRepository(root);
  const intent = { engine: "claude" as const, workspacePath: null };
  const record: TaskSubmissionRecord = {
    fingerprint: "old",
    stage: "ready",
    task: {
      id: "task",
      projectId: "p",
      title: "任务",
      pinned: false,
      updatedAt: "2026-11-10T00:00:00Z",
    },
  };
  await repo.writeAcpSubmission("p", "old", record, intent);
  const peer = await openRepository(root);
  const outcomes = await Promise.all([
    repo.recoverAcpSubmission("p", "old", "next-a", "a", intent),
    peer.recoverAcpSubmission("p", "old", "next-b", "b", intent),
  ]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(outcomes.find(Boolean)?.task?.id).toBe("task");
  expect(await repo.readSubmission("p", "old")).toEqual({ ...record, stage: "starting" });
  expect(await repo.claimSubmission("p", "old", record, { ...record, stage: "starting" })).toBe(
    false,
  );
  await peer.close();
  await repo.close();
  const reopened = await openRepository(root);
  expect(await reopened.recoverAcpSubmission("p", "old", "later", "x", intent)).toBeUndefined();
  await reopened.close();
});

it("拒绝跨项目、换引擎、换目录和未知执行结果的恢复", async () => {
  const repo = await openRepository(await createWorkspace());
  const intent = { engine: "claude" as const, workspacePath: null };
  const task = {
    id: "task",
    projectId: "p",
    title: "任务",
    pinned: false,
    updatedAt: "2026-11-10T00:00:00Z",
  };
  await repo.writeAcpSubmission("p", "old", { fingerprint: "old", stage: "ready", task }, intent);
  expect(await repo.recoverAcpSubmission("other", "old", "next", "x", intent)).toBeUndefined();
  expect(
    await repo.recoverAcpSubmission("p", "old", "next", "x", { ...intent, engine: "codex" }),
  ).toBeUndefined();
  expect(
    await repo.recoverAcpSubmission("p", "old", "next", "x", {
      ...intent,
      workspacePath: "/other",
    }),
  ).toBeUndefined();
  await repo.writeAcpSubmission(
    "p",
    "old",
    { fingerprint: "old", stage: "starting", task },
    intent,
  );
  expect(await repo.recoverAcpSubmission("p", "old", "next", "x", intent)).toBeUndefined();
  await repo.close();
});

it("容量失败回滚整个转交，原请求仍可恢复且没有孤立新意图", async () => {
  const root = await createWorkspace();
  const intent = { engine: "claude" as const, workspacePath: null };
  const first = await openRepository(root);
  const record: TaskSubmissionRecord = {
    fingerprint: "old",
    stage: "ready",
    task: {
      id: "task",
      projectId: "p",
      title: "任务",
      pinned: false,
      updatedAt: "2026-11-10T00:00:00Z",
    },
  };
  await first.writeAcpSubmission("p", "old", record, intent);
  await first.close();
  const db = new Database(join(root, "state.sqlite3"));
  try {
    const insert = db.prepare(
      "INSERT INTO task_submissions(project_id,submission_key,record_json,completed,updated_at) VALUES('p',?,?,0,0)",
    );
    db.transaction(() => {
      for (let i = 0; i < 9999; i++)
        insert.run(
          `pending-${String(i)}`,
          JSON.stringify({ fingerprint: `pending-${String(i)}`, stage: "starting" }),
        );
    })();
  } finally {
    db.close();
  }
  const repo = await openRepository(root);
  await expect(repo.recoverAcpSubmission("p", "old", "next", "x", intent)).rejects.toThrow(
    "capacity",
  );
  expect(await repo.readSubmission("p", "old")).toEqual(record);
  expect(await repo.readSubmission("p", "next")).toBeUndefined();
  await repo.close();
  const inspect = new Database(join(root, "state.sqlite3"), { readonly: true });
  try {
    expect(inspect.prepare("SELECT submission_key FROM acp_submission_intents").all()).toEqual([
      { submission_key: "old" },
    ]);
  } finally {
    inspect.close();
  }
});

it("两个 Worker 对同一创建意图只能认领一次", async () => {
  const root = await createWorkspace(),
    one = await openRepository(root),
    two = await openRepository(root);
  const creating: TaskSubmissionRecord = { fingerprint: "same", stage: "creating" };
  const claims = await Promise.all([
    one.claimSubmission("p", "create", undefined, creating),
    two.claimSubmission("p", "create", undefined, creating),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(await one.readSubmission("p", "create")).toEqual(creating);
});
