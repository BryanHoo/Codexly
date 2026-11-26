import type { AgentTaskSnapshotResponse } from "@codexly/protocol";
import { expect, test } from "vitest";
import { createHarness, snapshot } from "./app-all.test-support.js";

test("ACP 历史读取不依赖旧设置和模型发现，保留快照边界及续页", async () => {
  const harness = await createHarness();
  const acpSnapshot = { ...snapshot, runtime: "acp" as const, turnsNextCursor: "older" };
  harness.readTask.mockResolvedValue(acpSnapshot);
  harness.readTaskSettings.mockRejectedValue(new Error("不得读取旧任务设置"));
  harness.readProjectDefaults.mockRejectedValue(new Error("不得读取旧项目设置"));
  harness.listModels.mockRejectedValue(new Error("不得发现旧模型"));
  const response = await harness.app.inject({
    method: "GET",
    url: "/v1/projects/codexly/tasks/task-1?cursor=page-2",
  });
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json<AgentTaskSnapshotResponse>();
  expect(body.snapshot).toEqual(acpSnapshot);
  expect(typeof body.checkpoint.sessionId).toBe("string");
  expect(body.checkpoint.sequence).toBe(0);
  expect(body.snapshot).not.toHaveProperty("settings");
  expect(harness.readTaskSettings).not.toHaveBeenCalled();
  expect(harness.readProjectDefaults).not.toHaveBeenCalled();
  expect(harness.listModels).not.toHaveBeenCalled();
  expect(harness.readTask).toHaveBeenCalledTimes(1);
  expect(harness.readTask.mock.calls[0]?.[1]?.cursor).toBe("page-2");
});
