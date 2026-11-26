import Database from "better-sqlite3";
import { join } from "node:path";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import { expect, it } from "vitest";
import definition from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
it("精简索引分页、来源隔离，到期查询排除禁用、陈旧和未知运行", async () => {
  const store = await openRepository(await createWorkspace());
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  for (const [source, id, enabled] of [
    ["web", "a", true],
    ["web", "b", true],
    ["web", "c", false],
    ["desktop", "a", true],
  ] as const) {
    await call("acp.plan.set", {
      source,
      scheduleId: id,
      definition: { ...definition, enabled },
      expectedRevision: 0,
    });
    await call("acp.plan.arm", {
      source,
      scheduleId: id,
      expectedRevision: 1,
      expectedStateRevision: 0,
      nextRunAt: 10,
    });
  }
  const page = await call("acp.plan.list", { source: "web", limit: 1 });
  expect(page).toMatchObject({
    data: [{ scheduleId: "a", name: definition.name }],
    nextCursor: "a",
  });
  expect(JSON.stringify(page)).not.toContain('"prompt"');
  expect(JSON.stringify(page)).not.toContain('"values"');
  expect(await call("acp.plan.list", { source: "web", after: "a", limit: 2 })).toMatchObject({
    data: [{ scheduleId: "b" }, { scheduleId: "c" }],
    nextCursor: null,
  });
  expect(await call("acp.plan.due", { source: "web", now: 9, limit: 10 })).toEqual([]);
  expect(await call("acp.plan.due", { source: "web", now: 10, limit: 10 })).toMatchObject([
    { scheduleId: "a" },
    { scheduleId: "b" },
  ]);
  await call("acp.plan.set", {
    source: "web",
    scheduleId: "b",
    definition: { ...definition, enabled: true, name: "Edited" },
    expectedRevision: 1,
  });
  await call("acp.plan.claim", {
    source: "web",
    scheduleId: "a",
    expectedRevision: 1,
    expectedStateRevision: 1,
    runId: "r",
    now: 10,
    nextRunAt: 20,
  });
  expect(await call("acp.plan.due", { source: "web", now: 30, limit: 10 })).toEqual([]);
  expect(await call("acp.plan.due", { source: "desktop", now: 10, limit: 1 })).toMatchObject([
    { scheduleId: "a" },
  ]);
});

it("已有定义升级回填索引，索引写入失败时整份定义回滚", async () => {
  const root = await createWorkspace();
  let store = await openRepository(root);
  const key = { source: "web" as const, scheduleId: "upgrade" };
  const body = {
    ...(definition as AcpScheduledPlanDefinition),
    prompt: { ...definition.prompt, type: "prompt" as const, text: "x".repeat(100000) },
  };
  await store.catalog("acp.plan.set", { ...key, definition: body, expectedRevision: 0 });
  const db = new Database(join(root, "state.sqlite3"));
  const version = db.pragma("user_version", { simple: true });
  try {
    db.exec(
      "DROP TRIGGER acp_plan_index_insert; DROP TRIGGER acp_plan_index_update; DROP TABLE acp_plan_index;",
    );
    await store.close();
    store = await openRepository(root);
    const page = await store.catalog("acp.plan.list", { source: "web", limit: 10 });
    expect(page.data).toMatchObject([
      { scheduleId: "upgrade", revision: 1, name: definition.name },
    ]);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(10000);
    db.exec(
      "CREATE TRIGGER block_acp_index BEFORE UPDATE ON acp_plan_index BEGIN SELECT RAISE(ABORT,'index failed'); END;",
    );
    await expect(
      store.catalog("acp.plan.set", {
        ...key,
        definition: { ...body, name: "Changed" },
        expectedRevision: 1,
      }),
    ).rejects.toThrow("index failed");
    expect(await store.catalog("acp.plan.read", key)).toMatchObject({
      revision: 1,
      definition: { name: definition.name },
    });
    expect(db.pragma("user_version", { simple: true })).toBe(version);
  } finally {
    db.close();
  }
});
