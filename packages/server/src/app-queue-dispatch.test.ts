import { expect, test } from "vitest";
import { createHarness, snapshot } from "./app-all.test-support.js";

const base = "/v1/projects/codexly/tasks/task-1/queue";
const input = { attachments: [], skills: [], text: "队列正文", type: "prompt" };
const running = {
  id: "active-turn",
  status: "running" as const,
  items: [{ id: "previous", type: "message" as const, role: "user" as const, text: "之前的请求" }],
  error: null,
  startedAt: null,
  completedAt: null,
};

test("blocks retries when saving an edit has an unknown launch result", async () => {
  const { app, startTurn } = await createHarness();
  const added = await app.inject({
    method: "POST",
    url: base,
    headers: { "idempotency-key": "add-edit" },
    payload: { input, clientUserMessageId: "message" },
  });
  const id = added.json<{ queuedSubmission: { id: string } }>().queuedSubmission.id;
  await app.inject({
    method: "PUT",
    url: `${base}/${id}`,
    headers: { "idempotency-key": "edit" },
    payload: { input, status: "editing" },
  });
  startTurn.mockRejectedValueOnce(new Error("response lost"));
  const save = await app.inject({
    method: "PUT",
    url: `${base}/${id}`,
    headers: { "idempotency-key": "save" },
    payload: { input, status: "queued" },
  });
  expect(save.statusCode).toBe(502);
  const retry = await app.inject({
    method: "PUT",
    url: `${base}/${id}`,
    headers: { "idempotency-key": "retry" },
    payload: { input, status: "queued" },
  });
  expect(retry.statusCode).toBe(409);
  expect(startTurn).toHaveBeenCalledOnce();
});

test("dispatches from the server snapshot and replays concurrent requests without steering twice", async () => {
  const { app, readTask, steerTurn, startTurn } = await createHarness();
  const added = await app.inject({
    method: "POST",
    url: base,
    headers: { "idempotency-key": "add" },
    payload: { input, clientUserMessageId: "message" },
  });
  expect(added.statusCode).toBe(201);
  const { queuedSubmission } = added.json<{ queuedSubmission: { id: string } }>();
  // 入队后任务开始运行；发送意图不携带浏览器缓存的 Turn ID 或正文。
  readTask.mockResolvedValue({ ...snapshot, turns: [running] });
  const request = {
    method: "POST" as const,
    url: `${base}/start`,
    headers: { "idempotency-key": "dispatch" },
    payload: { queuedSubmissionId: queuedSubmission.id },
  };
  const [first, concurrent] = await Promise.all([app.inject(request), app.inject(request)]);
  expect(first.statusCode).toBe(201);
  expect(first.json()).toMatchObject({ taskId: "task-1", turn: running });
  expect(concurrent.json()).toEqual(first.json());
  expect((await app.inject(request)).json()).toEqual(first.json());
  expect(steerTurn).toHaveBeenCalledExactlyOnceWith(
    "task-1",
    "active-turn",
    expect.objectContaining({ text: "队列正文" }),
  );
  expect(startTurn).not.toHaveBeenCalled();
  expect((await app.inject({ method: "GET", url: base })).json()).toEqual({
    data: [],
  });
});

test("enforces the editing barrier before steering", async () => {
  const { app, readTask, steerTurn, startTurn } = await createHarness();
  readTask.mockResolvedValue({ ...snapshot, turns: [running] });
  const ids: string[] = [];
  for (const key of ["first", "second"]) {
    const response = await app.inject({
      method: "POST",
      url: base,
      headers: { "idempotency-key": key },
      payload: { input, clientUserMessageId: key },
    });
    ids.push(response.json<{ queuedSubmission: { id: string } }>().queuedSubmission.id);
  }
  await app.inject({
    method: "PUT",
    url: `${base}/${ids[0] ?? ""}`,
    headers: { "idempotency-key": "edit" },
    payload: { input, status: "editing" },
  });
  const blocked = await app.inject({
    method: "POST",
    url: `${base}/start`,
    headers: { "idempotency-key": "dispatch" },
    payload: { queuedSubmissionId: ids[1] },
  });
  expect(blocked.statusCode).toBe(409);
  expect(steerTurn).not.toHaveBeenCalled();
  expect(startTurn).not.toHaveBeenCalled();
});
