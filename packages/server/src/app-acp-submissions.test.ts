import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  createSettingsRepository,
} from "./app-all.test-support.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
import { AgentTurnNotSubmittedError, type TaskSubmissionRepository } from "@codexly/core";

const turn = {
  id: "acp-turn",
  status: "running" as const,
  items: [],
  startedAt: "2026-11-10T00:00:00.000Z",
  completedAt: null,
  error: null,
};
const request = {
  method: "POST" as const,
  url: "/v1/projects/codexly/submissions",
  headers: { "idempotency-key": "acp-prompt-once" },
  payload: {
    type: "acp-prompt",
    taskId: "task-1",
    input: { type: "prompt", attachments: [], skills: [], text: "继续旧会话" },
  },
};

async function fixture(repository?: TaskSubmissionRepository) {
  const h = createProvider(),
    settings = createSettingsRepository();
  const startConfiguredTurn = vi.fn(() => Promise.resolve(turn));
  const app = await createCodexlyServer(
    createServerOptions(
      { ...h.provider, startConfiguredTurn },
      {
        settingsRepository: settings.repository,
        ...(repository ? { submissionRepository: repository } : {}),
      },
    ),
  );
  closeCallbacks.push(() => app.close());
  return { ...h, ...settings, startConfiguredTurn, app };
}

it("ACP 续聊使用权威会话配置，不读取模型列表、不写旧设置且重复提交只执行一次", async () => {
  const h = await fixture();
  const first = await h.app.inject(request),
    repeated = await h.app.inject(request);
  expect(first.statusCode, first.body).toBe(201);
  expect(repeated.json()).toEqual(first.json());
  expect(first.json()).toMatchObject({
    taskId: "task-1",
    turn: { id: "acp-turn" },
    checkpoint: { sequence: 0 },
  });
  expect(h.startConfiguredTurn).toHaveBeenCalledExactlyOnceWith(
    "task-1",
    expect.objectContaining({ text: "继续旧会话" }),
  );
  expect(h.startTurn).not.toHaveBeenCalled();
  expect(h.listModels).not.toHaveBeenCalled();
  expect(h.writeTaskSettings).not.toHaveBeenCalled();
  expect(
    (await h.app.inject({ ...request, payload: { ...request.payload, taskId: "foreign" } }))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await h.app.inject({
        ...request,
        headers: { "idempotency-key": "foreign" },
        payload: { ...request.payload, taskId: "foreign" },
      })
    ).statusCode,
  ).toBe(404);
  expect(h.startConfiguredTurn).toHaveBeenCalledOnce();
});

it("ACP 提交拒绝旧配置字段，不静默删除后继续执行", async () => {
  const h = await fixture();
  expect(
    (await h.app.inject({ ...request, payload: { ...request.payload, options: { model: "old" } } }))
      .statusCode,
  ).toBe(400);
  expect(h.startConfiguredTurn).not.toHaveBeenCalled();
});

it("ACP 新任务按请求引擎创建，重复提交保留应用任务身份", async () => {
  const h = await fixture();
  const payload = { type: "acp-prompt", engine: "claude", input: request.payload.input };
  const first = await h.app.inject({ ...request, payload });
  const repeated = await h.app.inject({ ...request, payload });
  expect(first.statusCode, first.body).toBe(201);
  expect(repeated.json()).toEqual(first.json());
  expect(first.json()).toMatchObject({ createdTask: { id: "task-1" }, taskId: "task-1" });
  expect(h.startTask).toHaveBeenCalledExactlyOnceWith({ engine: "claude" });
  expect(h.startConfiguredTurn).toHaveBeenCalledOnce();
  expect(h.writeTaskSettings).not.toHaveBeenCalled();
});

it("ACP 未授权附件和跨引擎续聊在执行前拒绝", async () => {
  const h = await fixture();
  const attachment = await h.app.inject({
    ...request,
    payload: {
      ...request.payload,
      input: { ...request.payload.input, attachments: [{ id: "foreign-upload" }] },
    },
  });
  expect(attachment.statusCode).toBe(404);
  const engine = await h.app.inject({
    ...request,
    headers: { "idempotency-key": "wrong-engine" },
    payload: { ...request.payload, engine: "claude" },
  });
  expect(engine.statusCode).toBe(400);
  expect(h.startConfiguredTurn).not.toHaveBeenCalled();
});

it("缺少 ACP 端口时明确拒绝且不调用旧发送端口", async () => {
  const h = createProvider();
  const app = await createCodexlyServer(createServerOptions(h.provider));
  closeCallbacks.push(() => app.close());
  expect((await app.inject(request)).statusCode).toBe(503);
  expect(h.startTurn).not.toHaveBeenCalled();
});

it("ACP 明确未提交时可以使用原幂等身份重试", async () => {
  const h = await fixture();
  h.startConfiguredTurn.mockRejectedValueOnce(new AgentTurnNotSubmittedError("配置尚不可用"));
  expect((await h.app.inject(request)).statusCode).toBe(502);
  const retried = await h.app.inject(request);
  expect(retried.statusCode, retried.body).toBe(201);
  expect(h.startConfiguredTurn).toHaveBeenCalledTimes(2);
});

it("ACP 提交结果不确定时跨服务重启禁止重复 prompt", { timeout: 15_000 }, async () => {
  const root = await createWorkspace();
  const repository = await openRepository(root),
    first = await fixture(repository);
  first.startConfiguredTurn.mockRejectedValueOnce(new Error("transport lost after submission"));
  expect((await first.app.inject(request)).statusCode).toBe(502);
  await first.app.close();
  await repository.close();
  const reopened = await openRepository(root),
    second = await fixture(reopened);
  const response = await second.app.inject(request);
  expect(response.statusCode, response.body).toBe(409);
  expect(response.json()).toMatchObject({ code: "SUBMISSION_OUTCOME_UNKNOWN" });
  expect(second.startConfiguredTurn).not.toHaveBeenCalled();
});

it("首发配置随同持久提交交付，重试不重复执行或写旧设置", async () => {
  const h = await fixture();
  const payload = {
    type: "acp-prompt",
    engine: "codex",
    input: request.payload.input,
    initialConfig: { enabled: false, model: "raw-model" },
  };
  const first = await h.app.inject({ ...request, payload });
  expect(first.statusCode, first.body).toBe(201);
  expect((await h.app.inject({ ...request, payload })).json()).toEqual(first.json());
  expect(h.startConfiguredTurn).toHaveBeenCalledExactlyOnceWith(
    expect.any(String),
    expect.objectContaining({ text: "继续旧会话" }),
    payload.initialConfig,
  );
  expect(h.writeTaskSettings).not.toHaveBeenCalled();
  const changed = await h.app.inject({
    ...request,
    payload: { ...payload, initialConfig: { enabled: true } },
  });
  expect(changed.statusCode).toBe(409);
});

it("首发配置失败后跨服务重启沿用已创建任务和配置", { timeout: 15000 }, async () => {
  const root = await createWorkspace();
  const repository = await openRepository(root),
    first = await fixture(repository);
  const payload = {
    type: "acp-prompt",
    engine: "claude",
    input: request.payload.input,
    initialConfig: { enabled: false },
  };
  first.startConfiguredTurn.mockRejectedValueOnce(
    new AgentTurnNotSubmittedError("配置失败，未发送"),
  );
  expect((await first.app.inject({ ...request, payload })).statusCode).toBe(502);
  expect(first.startTask).toHaveBeenCalledOnce();
  await first.app.close();
  await repository.close();
  const reopened = await openRepository(root),
    second = await fixture(reopened);
  const response = await second.app.inject({ ...request, payload });
  expect(response.statusCode, response.body).toBe(201);
  expect(second.startTask).not.toHaveBeenCalled();
  expect(second.startConfiguredTurn).toHaveBeenCalledExactlyOnceWith(
    "task-1",
    expect.objectContaining({ text: "继续旧会话" }),
    { enabled: false },
  );
});

it("修改首发配置通过恢复键复用任务，旧请求此后禁止再次执行", async () => {
  const h = await fixture();
  const payload = {
    type: "acp-prompt",
    engine: "claude",
    input: request.payload.input,
    initialConfig: { enabled: false },
  };
  h.startConfiguredTurn.mockRejectedValueOnce(new AgentTurnNotSubmittedError("配置失败"));
  expect((await h.app.inject({ ...request, payload })).statusCode).toBe(502);
  const recovered = await h.app.inject({
    ...request,
    headers: { "idempotency-key": "changed" },
    payload: { ...payload, initialConfig: { enabled: true }, recoveryKey: "acp-prompt-once" },
  });
  expect(recovered.statusCode, recovered.body).toBe(201);
  expect(h.startTask).toHaveBeenCalledOnce();
  expect(h.startConfiguredTurn).toHaveBeenLastCalledWith(
    "task-1",
    expect.objectContaining({ text: "继续旧会话" }),
    { enabled: true },
  );
  expect((await h.app.inject({ ...request, payload })).statusCode).toBe(409);
  expect(h.startConfiguredTurn).toHaveBeenCalledTimes(2);
});

it("服务重启后修改配置仍原子恢复到同一任务", { timeout: 15000 }, async () => {
  const root = await createWorkspace();
  const repository = await openRepository(root),
    first = await fixture(repository);
  const payload = {
    type: "acp-prompt",
    engine: "claude",
    input: request.payload.input,
    initialConfig: { enabled: false },
  };
  first.startConfiguredTurn.mockRejectedValueOnce(new AgentTurnNotSubmittedError("配置失败"));
  expect((await first.app.inject({ ...request, payload })).statusCode).toBe(502);
  await first.app.close();
  await repository.close();
  const reopened = await openRepository(root),
    second = await fixture(reopened);
  const recovered = await second.app.inject({
    ...request,
    headers: { "idempotency-key": "after-restart" },
    payload: { ...payload, initialConfig: { enabled: true }, recoveryKey: "acp-prompt-once" },
  });
  expect(recovered.statusCode, recovered.body).toBe(201);
  expect(second.startTask).not.toHaveBeenCalled();
  expect(second.startConfiguredTurn).toHaveBeenCalledExactlyOnceWith(
    "task-1",
    expect.objectContaining({ text: "继续旧会话" }),
    { enabled: true },
  );
  expect((await second.app.inject({ ...request, payload })).statusCode).toBe(409);
});

it("旧请求已读准备态后遇到恢复转交，仍不能重新发送", { timeout: 15000 }, async () => {
  const { createMemorySubmissionRepository } = await import("./task-submission-service.js");
  const repository = createMemorySubmissionRepository(100),
    first = await fixture(repository);
  const payload = {
    type: "acp-prompt",
    engine: "claude",
    input: request.payload.input,
    initialConfig: { enabled: false },
  };
  first.startConfiguredTurn.mockRejectedValueOnce(new AgentTurnNotSubmittedError("配置失败"));
  await first.app.inject({ ...request, payload });
  let release!: () => void, captured!: () => void;
  const blocked = new Promise<void>((done) => {
      release = done;
    }),
    seen = new Promise<void>((done) => {
      captured = done;
    });
  const read = repository.readSubmission.bind(repository);
  vi.spyOn(repository, "readSubmission").mockImplementationOnce(async (project, key) => {
    const snapshot = await read(project, key);
    captured();
    await blocked;
    return snapshot;
  });
  const stale = first.app.inject({ ...request, payload }).then((response) => response);
  await seen;
  const second = await fixture(repository);
  try {
    const recovered = await second.app.inject({
      ...request,
      headers: { "idempotency-key": "racing" },
      payload: { ...payload, initialConfig: { enabled: true }, recoveryKey: "acp-prompt-once" },
    });
    expect(recovered.statusCode, recovered.body).toBe(201);
  } finally {
    release();
  }
  expect((await stale).statusCode).toBe(409);
  expect(first.startConfiguredTurn).toHaveBeenCalledOnce();
  expect(second.startConfiguredTurn).toHaveBeenCalledOnce();
});
