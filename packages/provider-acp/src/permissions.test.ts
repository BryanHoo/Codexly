import { it, expect } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk/unstable";
import { AcpPermissions } from "./permissions.js";
const original: RequestPermissionRequest = {
  sessionId: "session",
  toolCall: { toolCallId: "tool", title: "修改文件" },
  options: [
    { optionId: "once", kind: "allow_once", name: "允许一次" },
    { optionId: "always", kind: "allow_always", name: "始终允许" },
    { optionId: "reject", kind: "reject_once", name: "拒绝" },
  ],
};
it("保留所有原始选项，精确选择 optionId，拒绝跨任务和未知选项", async () => {
  const events: AgentProviderEvent[] = [];
  const broker = new AcpPermissions("project", (e) => {
    events.push(e);
  });
  const pending = broker.request("task", "turn", original, new AbortController().signal);
  const request = broker.list("task")[0];
  if (!request) throw new Error("请求缺失");
  expect(request.acpOptions).toEqual(original.options);
  expect(request.availableDecisions).toEqual(["allow", "deny"]);
  const input = { ...request, resolution: { decision: "allow" as const, optionId: "always" } };
  expect(() => broker.resolve({ ...input, taskId: "other" })).toThrow("不匹配");
  expect(() =>
    broker.resolve({ ...input, resolution: { decision: "allow", optionId: "unknown" } }),
  ).toThrow("选项");
  expect(broker.resolve(input).status).toBe("resolved");
  expect(await pending).toEqual({ outcome: { outcome: "selected", optionId: "always" } });
  expect(broker.list("task")).toEqual([]);
  expect(events.map((e) => e.type)).toEqual([
    "pending_request.created",
    "pending_request.resolved",
  ]);
});
it("旧允许操作只能选择 allow_once，绝不扩大为始终允许", async () => {
  const broker = new AcpPermissions("project", () => undefined);
  const result = broker.request(
    "task",
    "turn",
    { ...original, options: original.options.filter((o) => o.kind === "allow_always") },
    new AbortController().signal,
  );
  const request = broker.list("task")[0];
  if (!request) throw new Error("请求缺失");
  expect(() => broker.resolve({ ...request, resolution: { decision: "allow" } })).toThrow("选项");
  broker.resolve({ ...request, resolution: { decision: "deny" } });
  expect(await result).toEqual({ outcome: { outcome: "cancelled" } });
});
it("请求撤销和关闭释放等待，不自动批准", async () => {
  const broker = new AcpPermissions("project", () => undefined);
  const controller = new AbortController();
  const result = broker.request("task", "turn", original, controller.signal);
  controller.abort();
  expect(await result).toEqual({ outcome: { outcome: "cancelled" } });
  expect(broker.list("task")).toEqual([]);
  const other = broker.request("task", "turn", original, new AbortController().signal);
  broker.close();
  expect(await other).toEqual({ outcome: { outcome: "cancelled" } });
});
