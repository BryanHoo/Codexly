import type { AcpConfigPreview } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import definition from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { fixture } from "./acp-plan-executor.test-support.js";
import { AcpPlanService } from "./acp-plan-service.js";

function checked(): AcpConfigPreview {
  return {
    values: { model: "raw", flag: false },
    configOptions: [
      {
        id: "model",
        name: "模型",
        type: "select",
        currentValue: "raw",
        options: [{ value: "raw", name: "原始模型" }],
      },
      { id: "flag", name: "开关", type: "boolean", currentValue: false },
    ],
  };
}
async function setup() {
  const h = await fixture();
  const previewConfig = vi.fn((): Promise<AcpConfigPreview> => Promise.resolve(checked()));
  const wake = vi.fn();
  const service = new AcpPlanService({
    catalog: h.store,
    getProjectContext: h.getProjectContext,
    agents: { codex: { previewConfig }, claude: { previewConfig } },
    wake,
    now: () => 100,
  });
  const body = {
    definition: {
      ...definition,
      engine: "codex",
      values: { model: "raw", flag: false },
      enabled: true,
      schedule: { type: "once", atUnixMs: 1000 },
    } as AcpScheduledPlanDefinition,
    resources: [],
    expectedRevision: 0,
    expectedStateRevision: 0,
  };
  return { ...h, service, body, previewConfig, wake };
}
it("启用前预览原始 ACP 配置，原子武装并仅在保存成功后唤醒", async () => {
  const h = await setup();
  const saved = await h.service.save("edit", h.body);
  expect(saved).toMatchObject({
    revision: 1,
    state: { revision: 1, nextRunAt: 1000 },
    definition: { values: { model: "raw", flag: false } },
  });
  expect(h.previewConfig).toHaveBeenCalledWith(
    "/test",
    { values: h.body.definition.values },
    undefined,
  );
  expect(h.wake).toHaveBeenCalledTimes(1);
  // 普通编辑保留已完成一次性计划的空游标，不能重新执行。
  await h.store.catalog("acp.plan.arm", {
    source: "web",
    scheduleId: "edit",
    expectedRevision: 1,
    expectedStateRevision: 1,
    nextRunAt: null,
  });
  const edited = await h.service.save("edit", {
    ...h.body,
    definition: { ...h.body.definition, name: "重命名" },
    expectedRevision: 1,
    expectedStateRevision: 2,
  });
  expect(edited.state?.nextRunAt).toBeNull();
  expect(h.previewConfig).toHaveBeenCalledTimes(1);
  await expect(h.service.save("edit", h.body)).rejects.toMatchObject({ code: "conflict" });
  expect(h.wake).toHaveBeenCalledTimes(2);
});
it("禁用草稿无需 agent 预览，拒绝过去启用时间及额外路径字段", async () => {
  const h = await setup();
  h.previewConfig.mockRejectedValue(new Error("offline"));
  const saved = await h.service.save("draft", {
    ...h.body,
    definition: { ...h.body.definition, enabled: false, schedule: { type: "once", atUnixMs: 1 } },
  });
  expect(saved.state?.nextRunAt).toBeNull();
  expect(h.previewConfig).not.toHaveBeenCalled();
  await expect(h.service.save("invalid", { ...h.body, cwd: "/injected" })).rejects.toMatchObject({
    code: "invalid",
  });
  h.previewConfig.mockResolvedValue(checked());
  await expect(
    h.service.save("past", {
      ...h.body,
      definition: { ...h.body.definition, schedule: { type: "once", atUnixMs: 100 } },
    }),
  ).rejects.toMatchObject({ code: "invalid" });
  expect(await h.service.read("past")).toBeNull();
});
it("预览被拒绝、项目变更或预览期间游标变化不写入定义", async () => {
  const h = await setup();
  h.previewConfig.mockResolvedValue({ values: {}, configOptions: [] });
  await expect(h.service.save("rejected", h.body)).rejects.toMatchObject({ code: "invalid" });
  expect(await h.service.read("rejected")).toBeNull();
  h.previewConfig.mockImplementation(async () => {
    h.getProjectContext.mockResolvedValueOnce({
      ...(await h.getProjectContext()),
      scope: { id: "codexly", kind: "project", rootPath: "/changed", runtimeWorkspaceRoots: [] },
    });
    return checked();
  });
  await expect(h.service.save("changed", h.body)).rejects.toMatchObject({ code: "conflict" });
  expect(await h.service.read("changed")).toBeNull();
  expect(h.wake).not.toHaveBeenCalled();
});
it("保存后的唤醒异常不谎报保存失败，删除保留独立任务并允许孤立计划查看", async () => {
  const h = await setup();
  h.wake.mockImplementation(() => {
    throw new Error("wake failed");
  });
  const saved = await h.service.save("edit", h.body);
  expect(saved.revision).toBe(1);
  h.getProjectContext.mockRejectedValue(new Error("project removed"));
  expect(await h.service.read("edit")).toEqual(saved);
  expect(await h.service.delete("edit", 2)).toBe(false);
  expect(await h.service.delete("edit", 1)).toBe(true);
  expect(await h.service.read("edit")).toBeNull();
  expect(await h.store.catalog("acp.plan.readRun", { ...h.key, runId: "run" })).not.toBeNull();
});

it("预览期间调度状态被推进时拒绝旧修订，取消不写入且不唤醒", async () => {
  const h = await setup();
  const first = await h.service.save("race", h.body);
  h.previewConfig.mockImplementation(async () => {
    await h.store.catalog("acp.plan.arm", {
      source: "web",
      scheduleId: "race",
      expectedRevision: 1,
      expectedStateRevision: 1,
      nextRunAt: null,
    });
    return {
      ...checked(),
      values: { model: "changed", flag: false },
      configOptions: [
        { id: "model", name: "模型", type: "select", currentValue: "changed", options: [] },
        { id: "flag", name: "开关", type: "boolean", currentValue: false },
      ],
    };
  });
  await expect(
    h.service.save("race", {
      ...h.body,
      definition: { ...h.body.definition, values: { model: "changed", flag: false } },
      expectedRevision: 1,
      expectedStateRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await h.service.read("race")).toMatchObject({
    revision: 1,
    definition: first.definition,
    state: { revision: 2 },
  });
  const controller = new AbortController();
  controller.abort();
  await expect(h.service.save("cancelled", h.body, controller.signal)).rejects.toThrow();
  expect(await h.service.read("cancelled")).toBeNull();
  expect(h.wake).toHaveBeenCalledTimes(1);
});
it("有限周期结束保持空游标，规则属性顺序变化不会重新计算已结束计划", async () => {
  const h = await setup();
  const schedule = {
    type: "rrule" as const,
    startAtUnixMs: 0,
    rrule: "FREQ=DAILY;COUNT=1",
    timezone: "UTC",
  };
  const first = await h.service.save("ended", {
    ...h.body,
    definition: { ...h.body.definition, schedule },
  });
  expect(first.state?.nextRunAt).toBeNull();
  const second = await h.service.save("ended", {
    ...h.body,
    definition: {
      ...h.body.definition,
      schedule: { timezone: "UTC", rrule: "FREQ=DAILY;COUNT=1", type: "rrule", startAtUnixMs: 0 },
    },
    expectedRevision: 1,
    expectedStateRevision: 1,
  });
  expect(second.state?.nextRunAt).toBeNull();
  expect(h.previewConfig).toHaveBeenCalledTimes(1);
});

it("附件暂存复用项目授权，拒绝改绑及运行占用，不改变原上传所有权", async () => {
  const h = await setup();
  const stage = vi.fn(() =>
    Promise.resolve({
      token: "token",
      attachment: { id: "ref", kind: "file" as const, mediaType: "x", name: "a", size: 1 },
      written: 1,
      digest: "digest",
      boundRevision: null,
    }),
  );
  const service = new AcpPlanService({
    catalog: h.store,
    getProjectContext: h.getProjectContext,
    agents: {},
    resources: { stage },
  });
  await h.service.save("draft", {
    ...h.body,
    definition: { ...h.body.definition, enabled: false },
  });
  expect(await service.stage("draft", "p", "upload")).toMatchObject({ token: "token" });
  expect(stage).toHaveBeenCalledWith(
    { source: "web", scheduleId: "draft", projectId: "p" },
    "upload",
    undefined,
  );
  await expect(service.stage("draft", "foreign", "upload")).rejects.toMatchObject({
    code: "conflict",
  });
  await expect(service.stage("plan", "codexly", "upload")).rejects.toMatchObject({ code: "busy" });
  expect(stage).toHaveBeenCalledTimes(1);
});
