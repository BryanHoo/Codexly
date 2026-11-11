import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import rawFixture from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

const fixture = rawFixture as AcpScheduledPlanDefinition;

it("定义、资源与游标原子提交，一致读取检查双修订和运行占用", async () => {
  const store = await openRepository(await createWorkspace());
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  const key = { source: "web", scheduleId: "plan" };
  const first = await call("acp.plan.commit", {
    ...key,
    definition: { ...fixture, enabled: true },
    resources: [],
    expectedRevision: 0,
    expectedStateRevision: 0,
    nextRunAt: 10,
  });
  expect(first).toMatchObject({
    ...key,
    revision: 1,
    canEdit: true,
    resources: [],
    state: { revision: 1, definitionRevision: 1, nextRunAt: 10 },
  });
  expect(await call("acp.plan.view", key)).toEqual(first);
  expect(
    await call("acp.plan.commit", {
      ...key,
      definition: fixture,
      resources: [],
      expectedRevision: 1,
      expectedStateRevision: 0,
      nextRunAt: null,
    }),
  ).toBeNull();
  expect(await call("acp.plan.view", key)).toEqual(first);
  const second = await call("acp.plan.commit", {
    ...key,
    definition: { ...fixture, name: "new" },
    resources: [],
    expectedRevision: 1,
    expectedStateRevision: 1,
    nextRunAt: null,
  });
  expect(second).toMatchObject({
    revision: 2,
    state: { revision: 2, definitionRevision: 2, nextRunAt: null },
  });
  const third = await call("acp.plan.commit", {
    ...key,
    definition: { ...fixture, enabled: true },
    resources: [],
    expectedRevision: 2,
    expectedStateRevision: 2,
    nextRunAt: 20,
  });
  expect(third).toMatchObject({ revision: 3, state: { revision: 3 } });
  await call("acp.plan.claim", {
    ...key,
    runId: "run",
    expectedRevision: 3,
    expectedStateRevision: 3,
    now: 20,
    nextRunAt: null,
  });
  expect(await call("acp.plan.view", key)).toMatchObject({
    canEdit: false,
    state: { revision: 4 },
  });
  expect(
    await call("acp.plan.commit", {
      ...key,
      definition: fixture,
      resources: [],
      expectedRevision: 3,
      expectedStateRevision: 4,
      nextRunAt: null,
    }),
  ).toBeNull();
});

it("游标写入失败回滚定义与资源回收，并发 Worker 只能提交一份修订", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const other = await openRepository(root);
  const key = { source: "web" as const, scheduleId: "plan" };
  const resource = { ...key, projectId: "p", token: "old" };
  await store.catalog("acp.resource.begin", {
    ...resource,
    attachment: { id: "a", kind: "file", mediaType: "x", name: "a", size: 1 },
  });
  await store.catalog("acp.resource.append", {
    ...resource,
    offset: 0,
    content: new Uint8Array([42]),
  });
  await store.catalog("acp.resource.seal", resource);
  const first = await store.catalog("acp.plan.commit", {
    ...key,
    definition: { ...fixture, prompt: { ...fixture.prompt, attachments: [{ id: "a" }] } },
    resources: ["old"],
    expectedRevision: 0,
    expectedStateRevision: 0,
    nextRunAt: null,
  });
  const edit = {
    ...key,
    definition: fixture,
    resources: [],
    expectedRevision: 1,
    expectedStateRevision: 1,
    nextRunAt: null,
  };
  const db = new Database(join(root, "state.sqlite3"));
  try {
    db.exec(
      "CREATE TRIGGER block_cursor BEFORE UPDATE ON acp_plan_state BEGIN SELECT RAISE(ABORT,'cursor failed'); END",
    );
    await expect(store.catalog("acp.plan.commit", edit)).rejects.toThrow("cursor failed");
    expect(await store.catalog("acp.plan.view", key)).toEqual(first);
    expect(await store.catalog("acp.resource.chunk", { ...resource, offset: 0 })).toEqual(
      new Uint8Array([42]),
    );
    db.exec("DROP TRIGGER block_cursor");
    const results = await Promise.all([
      store.catalog("acp.plan.commit", edit),
      other.catalog("acp.plan.commit", edit),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await other.catalog("acp.plan.view", key)).toMatchObject({
      revision: 2,
      resources: [],
      state: { revision: 2, definitionRevision: 2 },
    });
    await expect(
      store.catalog("acp.plan.commit", {
        ...edit,
        expectedRevision: 2,
        expectedStateRevision: 2,
        nextRunAt: 10,
      }),
    ).rejects.toThrow();
  } finally {
    db.close();
  }
});
