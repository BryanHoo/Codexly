import times from "../../../tests/fixtures/acp-plan-discovery-times.json" with { type: "json" };
import type { LocalCatalogStore } from "@codexly/core";
import { expect, it } from "vitest";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import data from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
import { discoverDueAcpPlans } from "./acp-plan-discovery.js";
it("发现并领取到期新计划，坏规则保留游标且不影响其他项", async () => {
  const store = await openRepository(await createWorkspace());
  const definition = data as AcpScheduledPlanDefinition;
  for (const scheduleId of ["a-bad", "b-once"]) {
    const schedule =
      scheduleId === "a-bad"
        ? { type: "rrule" as const, rrule: "invalid", timezone: "UTC", startAtUnixMs: 1 }
        : { type: "once" as const, atUnixMs: 10 };
    await store.catalog("acp.plan.set", {
      source: "web",
      scheduleId,
      definition: { ...definition, enabled: true, schedule },
      expectedRevision: 0,
    });
    await store.catalog("acp.plan.arm", {
      source: "web",
      scheduleId,
      expectedRevision: 1,
      expectedStateRevision: 0,
      nextRunAt: 10,
    });
  }
  const result = await discoverDueAcpPlans(store, 10);
  expect(result.claims).toHaveLength(1);
  expect(result.errors).toMatchObject([{ scheduleId: "a-bad" }]);
  expect(
    await store.catalog("acp.plan.readState", { source: "web", scheduleId: "a-bad" }),
  ).toMatchObject({ revision: 1, nextRunAt: 10 });
  expect(
    await store.catalog("acp.plan.readState", { source: "web", scheduleId: "b-once" }),
  ).toMatchObject({ revision: 2, nextRunAt: null });
  expect((await discoverDueAcpPlans(store, 11)).claims).toEqual([]);
});

it("错误占满批次后可继续扫描，后面的正常计划不会饥饿", async () => {
  const store = await openRepository(await createWorkspace());
  for (const id of ["a-bad", "b-once"]) {
    const schedule =
      id === "a-bad"
        ? { type: "rrule" as const, rrule: "invalid", timezone: "UTC", startAtUnixMs: 1 }
        : { type: "once" as const, atUnixMs: 10 };
    await store.catalog("acp.plan.set", {
      source: "web",
      scheduleId: id,
      definition: { ...(data as AcpScheduledPlanDefinition), enabled: true, schedule },
      expectedRevision: 0,
    });
    await store.catalog("acp.plan.arm", {
      source: "web",
      scheduleId: id,
      expectedRevision: 1,
      expectedStateRevision: 0,
      nextRunAt: 10,
    });
  }
  const first = await discoverDueAcpPlans(store, 10, 1);
  const second = await discoverDueAcpPlans(store, 10, 1, first.nextCursor);
  expect(second.claims).toHaveLength(1);
});

it("共享规则用例保持有限次数、时区和夏令时语义", async () => {
  const store = await openRepository(await createWorkspace());
  for (const item of times) {
    const key = { source: "web" as const, scheduleId: item.id };
    const definition = {
      ...(data as AcpScheduledPlanDefinition),
      enabled: true,
      schedule: { ...item.schedule, type: "rrule" as const },
    };
    await store.catalog("acp.plan.set", { ...key, definition, expectedRevision: 0 });
    await store.catalog("acp.plan.arm", {
      ...key,
      expectedRevision: 1,
      expectedStateRevision: 0,
      nextRunAt: item.now,
    });
    const result = await discoverDueAcpPlans(store, item.now);
    expect(result.errors).toEqual([]);
    expect(result.claims).toHaveLength(1);
    expect((await store.catalog("acp.plan.readState", key))?.nextRunAt).toBe(item.nextRunAt);
  }
});
it("规则计算完成后配置已改变，旧发现结果不能领取", async () => {
  const store = await openRepository(await createWorkspace());
  const key = { source: "web" as const, scheduleId: "race" };
  const definition = {
    ...(data as AcpScheduledPlanDefinition),
    enabled: true,
    schedule: { type: "once" as const, atUnixMs: 10 },
  };
  await store.catalog("acp.plan.set", { ...key, definition, expectedRevision: 0 });
  await store.catalog("acp.plan.arm", {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 0,
    nextRunAt: 10,
  });
  const wrapped: LocalCatalogStore = {
    async catalog(op, input) {
      if (op === "acp.plan.claim")
        await store.catalog("acp.plan.set", {
          ...key,
          definition: { ...definition, name: "Changed" },
          expectedRevision: 1,
        });
      return store.catalog(op, input);
    },
  };
  expect((await discoverDueAcpPlans(wrapped, 10)).claims).toEqual([]);
  expect(await store.catalog("acp.plan.readState", key)).toMatchObject({
    revision: 1,
    nextRunAt: 10,
  });
});
