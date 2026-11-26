import invalid from "../../../tests/fixtures/acp-scheduled-plan-invalid.json" with { type: "json" };
import {
  AcpScheduledPlanDefinitionSchema,
  type AcpScheduledPlanDefinition,
} from "@codexly/protocol/acp-scheduled-plan";
import generated from "../../protocol/src/acp-scheduled-plan-schema.js";
import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import definitionData from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

const definition = definitionData as AcpScheduledPlanDefinition;

it("新 ACP 计划独立保存，来源隔离、不可换项目、修订保护及重启恢复", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const call = (op: string, input: unknown) => store.catalog(op as never, input as never);
  const key = { source: "web", scheduleId: "new-plan" };
  const db = new Database(join(root, "state.sqlite3"));
  try {
    const old = db.prepare("SELECT tasks_json FROM scheduled_task_state WHERE id=1").get();
    const version = db.pragma("user_version", { simple: true });
    expect(await call("acp.plan.read", key)).toBeNull();
    expect(await call("acp.plan.set", { ...key, definition, expectedRevision: 0 })).toEqual({
      ...key,
      definition,
      revision: 1,
    });
    expect(await call("acp.plan.set", { ...key, definition, expectedRevision: 0 })).toBeNull();
    expect(
      await call("acp.plan.set", {
        ...key,
        definition: { ...definition, projectId: "other" },
        expectedRevision: 1,
      }),
    ).toBeNull();
    await call("acp.plan.set", { ...key, source: "desktop", definition, expectedRevision: 0 });
    await store.close();
    const reopened = await openRepository(root);
    expect(await reopened.catalog("acp.plan.read" as never, key as never)).toEqual({
      ...key,
      definition,
      revision: 1,
    });
    expect(
      await reopened.catalog("acp.plan.delete" as never, { ...key, expectedRevision: 0 } as never),
    ).toBe(false);
    expect(
      await reopened.catalog("acp.plan.delete" as never, { ...key, expectedRevision: 1 } as never),
    ).toBe(true);
    expect(
      await reopened.catalog("acp.plan.read" as never, { ...key, source: "desktop" } as never),
    ).not.toBeNull();
    expect(db.prepare("SELECT tasks_json FROM scheduled_task_state WHERE id=1").get()).toEqual(old);
    expect(db.pragma("user_version", { simple: true })).toBe(version);
  } finally {
    db.close();
  }
});

it("生成校验契约一致，非法定义及超出单项 / 数量预算不得落盘", async () => {
  expect(generated).toEqual(AcpScheduledPlanDefinitionSchema);
  const root = await createWorkspace();
  const store = await openRepository(root);
  const key = { source: "web" as const, scheduleId: "bounded" };
  for (const patch of invalid)
    await expect(
      store.catalog("acp.plan.set", {
        ...key,
        definition: { ...definition, ...patch } as typeof definition,
        expectedRevision: 0,
      }),
    ).rejects.toThrow();
  const huge = {
    ...definition,
    values: Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [String(i), "x".repeat(16384)]),
    ),
  };
  await expect(
    store.catalog("acp.plan.set", { ...key, definition: huge, expectedRevision: 0 }),
  ).rejects.toThrow();
  expect(await store.catalog("acp.plan.read", key)).toBeNull();
  await store.catalog("acp.plan.set", { ...key, definition, expectedRevision: 0 });
  const db = new Database(join(root, "state.sqlite3"));
  try {
    const insert = db.prepare("INSERT INTO acp_scheduled_plans VALUES ('web',?,?,1)");
    db.transaction(() => {
      for (let i = 0; i < 999; i++) insert.run(`filler-${String(i)}`, JSON.stringify(definition));
    })();
    await expect(
      store.catalog("acp.plan.set", {
        ...key,
        scheduleId: "overflow",
        definition,
        expectedRevision: 0,
      }),
    ).rejects.toThrow();
    expect(
      await store.catalog("acp.plan.set", {
        ...key,
        definition: { ...definition, name: "Updated" },
        expectedRevision: 1,
      }),
    ).toMatchObject({ revision: 2 });
  } finally {
    db.close();
  }
});

it("独立连接竞争同一修订时仅一项成功", async () => {
  const root = await createWorkspace();
  const a = await openRepository(root),
    b = await openRepository(root);
  const input = { source: "web" as const, scheduleId: "race", definition, expectedRevision: 0 };
  await a.catalog("acp.plan.set", input);
  const results = await Promise.all(
    [a, b].map((store, i) =>
      store.catalog("acp.plan.set", {
        ...input,
        expectedRevision: 1,
        definition: { ...definition, name: `Plan ${String(i)}` },
      }),
    ),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
});

it("总容量已满时拒绝新增，原定义保持", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const body = {
    ...definition,
    prompt: { ...definition.prompt, text: "x".repeat(100000) },
    values: Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [String(i), "x".repeat(16384)]),
    ),
  };
  const text = JSON.stringify(body);
  const db = new Database(join(root, "state.sqlite3"));
  try {
    await store.catalog("acp.plan.set", {
      source: "web",
      scheduleId: "first",
      definition: body,
      expectedRevision: 0,
    });
    const count = Math.floor(33554432 / Buffer.byteLength(text));
    const insert = db.prepare("INSERT INTO acp_scheduled_plans VALUES ('web',?,?,1)");
    db.transaction(() => {
      for (let i = 1; i < count; i++) insert.run(String(i), text);
    })();
    await expect(
      store.catalog("acp.plan.set", {
        source: "web",
        scheduleId: "overflow",
        definition: body,
        expectedRevision: 0,
      }),
    ).rejects.toThrow();
    expect(
      await store.catalog("acp.plan.read", { source: "web", scheduleId: "first" }),
    ).toMatchObject({ revision: 1 });
  } finally {
    db.close();
  }
});
