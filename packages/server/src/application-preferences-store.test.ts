import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

const baseline = {
  defaultAgent: "claude",
  defaultModel: "native/model",
  commitMessagePrompt: "提交规则",
  taskTitlePrompt: "标题规则",
  promptOptimizationPrompt: "优化规则",
  defaultOpenAppId: null,
  followUpBehavior: "queue",
  pet: { enabled: false, selectedPetId: null },
};

it("应用偏好不读取引擎，首次保存建私有快照并跨连接合并无关补丁", async () => {
  const root = await createWorkspace();
  const a = await openRepository(root),
    b = await openRepository(root);
  const call = (store: typeof a, op: string, p: unknown) => store.catalog(op as never, p as never);
  expect(await call(a, "app.preferences.read", {})).toBeNull();
  await Promise.all([
    call(a, "app.preferences.patch", { baseline, changes: { followUpBehavior: "steer" } }),
    call(b, "app.preferences.patch", { baseline, changes: { taskTitlePrompt: "新标题" } }),
  ]);
  await a.close();
  await b.close();
  const reopened = await openRepository(root);
  expect(await call(reopened, "app.preferences.read", {})).toEqual({
    ...baseline,
    followUpBehavior: "steer",
    taskTitlePrompt: "新标题",
  });
  expect(
    await call(reopened, "app.preferences.patch", {
      baseline: { ...baseline, taskTitlePrompt: "过时基线" },
      changes: { defaultAgent: "codex", defaultModel: null },
    }),
  ).toEqual({
    ...baseline,
    defaultAgent: "codex",
    defaultModel: null,
    followUpBehavior: "steer",
    taskTitlePrompt: "新标题",
  });
});

it("持久边界拒绝空补丁、未知字段和未配对模型，失败不落新记录", async () => {
  const store = await openRepository(await createWorkspace());
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  for (const changes of [
    {},
    { model: "x" },
    { defaultAgent: "codex" },
    { defaultModel: null },
    { defaultAgent: "other", defaultModel: "x" },
    { taskTitlePrompt: "长".repeat(4001) },
    { pet: { enabled: true, selectedPetId: null } },
  ]) {
    await expect(call("app.preferences.patch", { baseline, changes })).rejects.toThrow();
  }
  expect(await call("app.preferences.read", {})).toBeNull();
});

it("私有记录损坏必须明确失败，不能重新导入或覆盖；旧数据库版本保持不变", async () => {
  const root = await createWorkspace(),
    store = await openRepository(root);
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  const db = new Database(join(root, "state.sqlite3"));
  try {
    const version = db.pragma("user_version", { simple: true });
    await call("app.preferences.patch", { baseline, changes: { taskTitlePrompt: "新标题" } });
    expect(db.pragma("user_version", { simple: true })).toBe(version);
    db.prepare("UPDATE acp_application_preferences SET settings_json=? WHERE id=1").run(
      '{"broken":true}',
    );
    await expect(call("app.preferences.read", {})).rejects.toThrow();
    await expect(
      call("app.preferences.patch", { baseline, changes: { taskTitlePrompt: "不能覆盖" } }),
    ).rejects.toThrow();
    expect(db.prepare("SELECT settings_json FROM acp_application_preferences").get()).toEqual({
      settings_json: '{"broken":true}',
    });
  } finally {
    db.close();
  }
});
