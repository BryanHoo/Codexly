import { expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import rawFixture from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
const fixture = rawFixture as AcpScheduledPlanDefinition;
it("计划调用保留固定身份、双修订、原始 false、游标、取消与幂等键", async () => {
  const view = {
    source: "web",
    scheduleId: "plan/id",
    revision: 1,
    definition: fixture,
    state: { revision: 1, definitionRevision: 1, nextRunAt: null },
    canEdit: true,
    resources: [],
  };
  const metadata = {
    source: "web",
    scheduleId: "plan/id",
    revision: 1,
    name: fixture.name,
    projectId: fixture.projectId,
    engine: fixture.engine,
    enabled: false,
    schedule: fixture.schedule,
    stateRevision: 1,
    scheduledRevision: 1,
    nextRunAt: null,
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [metadata], nextCursor: "plan/id" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(view)));
  const client = new CodexlyClient({ baseUrl: "https://example.test", fetch });
  const controller = new AbortController();
  expect(
    await client.listAcpPlans({ after: "before/id", limit: 20 }, { signal: controller.signal }),
  ).toEqual({ data: [metadata], nextCursor: "plan/id" });
  const input = {
    definition: fixture,
    resources: [],
    expectedRevision: 0,
    expectedStateRevision: 0,
  };
  expect(
    await client.saveAcpPlan("plan/id", input, {
      idempotencyKey: "stable",
      signal: controller.signal,
    }),
  ).toEqual(view);
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "https://example.test/v1/acp/plans?after=before%2Fid&limit=20",
  );
  expect(fetch.mock.calls[1]?.[0]).toBe("https://example.test/v1/acp/plans/plan%2Fid");
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({
    method: "PUT",
    body: JSON.stringify(input),
    headers: { "idempotency-key": "stable" },
  });
});

it("读取、删除与授权附件使用独立路径，坏响应不能进入编辑状态", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true })))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token: "token",
          attachment: { id: "ref", kind: "file", mediaType: "x", name: "a", size: 1 },
          digest: "a".repeat(64),
          written: 1,
          boundRevision: null,
        }),
      ),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ definition: fixture, revision: "1" })));
  const client = new CodexlyClient({ baseUrl: "https://example.test", fetch });
  expect(await client.deleteAcpPlan("p/id", 2, { idempotencyKey: "delete" })).toEqual({
    deleted: true,
  });
  await client.stageAcpPlanResource(
    "p/id",
    { projectId: "p", uploadId: "u" },
    { idempotencyKey: "stage" },
  );
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    method: "DELETE",
    body: '{"expectedRevision":2}',
  });
  expect(fetch.mock.calls[1]?.[0]).toBe("https://example.test/v1/acp/plans/p%2Fid/resources");
  await expect(client.readAcpPlan("p/id")).rejects.toThrow();
});
