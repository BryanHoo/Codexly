import { describe, expect, it } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import type { AsyncQuestionGroup } from "@codexly/protocol";
import { createHarness } from "./app-all.test-support.js";
import { snapshot, turnOptions } from "./app.test-support.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

const url = "/v1/projects/codexly/tasks/task-1/async-questions";
function questionId(response: LightMyRequestResponse): string {
  expect(response.statusCode, response.body).toBe(200);
  const id = response.json<{ data: AsyncQuestionGroup[] }>().data[0]?.id;
  if (id === undefined) throw new Error("Missing async question");
  return id;
}
const question = {
  id: "native-id",
  type: "message" as const,
  role: "assistant" as const,
  text: "问题",
  questions: [{ title: "范围", options: ["当前文件", "整个项目"] }],
};
const source = {
  ...snapshot,
  turns: [
    {
      id: "turn-1",
      startedAt: "2026-09-12T00:00:00.000Z",
      completedAt: null,
      error: null,
      status: "running" as const,
      items: [question],
    },
  ],
  turnsNextCursor: null,
};

describe("async question API", () => {
  async function setup() {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    const harness = await createHarness({ asyncQuestionRepository: repository });
    harness.readTask.mockResolvedValue(source);
    return { ...harness, repository, root };
  }
  // 重启用例会创建两套真实服务与 SQLite Worker，为 Windows CI 的启动与磁盘 I/O 留出预算。
  it(
    "answers with one server-side steer and replays the accepted response after restart",
    { timeout: 15_000 },
    async () => {
      const first = await setup();
      const listed = await first.app.inject({ method: "GET", url });
      expect(listed.statusCode, listed.body).toBe(200);
      const id = questionId(listed);
      const request = {
        method: "POST" as const,
        url: `${url}/${id}/answer`,
        headers: { "idempotency-key": "answer" },
        payload: { answers: ["整个项目"] },
      };
      const results = await Promise.all([first.app.inject(request), first.app.inject(request)]);
      expect(results[0].statusCode, results[0].body).toBe(200);
      expect(results[0].json()).toMatchObject({ questions: { data: [] } });
      expect(first.steerTurn).toHaveBeenCalledOnce();
      expect(first.steerTurn).toHaveBeenCalledWith("task-1", expect.any(String), {
        text: "范围\n整个项目",
        skills: [],
        images: [],
        files: [],
        textAttachments: [],
      });
      expect(first.startTurn).not.toHaveBeenCalled();
      await first.app.close();
      await first.repository.close();
      const second = await createHarness({
        asyncQuestionRepository: await openRepository(first.root),
      });
      second.readTask.mockResolvedValue(source);
      expect((await second.app.inject(request)).json()).toEqual(results[0].json());
      expect(second.steerTurn).not.toHaveBeenCalled();
      expect((await second.app.inject({ method: "GET", url })).json()).toEqual({ data: [] });
    },
  );
  it("starts an idle task using persisted settings and rejects incomplete answers", async () => {
    const { app, readTask, startTurn, steerTurn, readTaskSettings } = await setup();
    readTaskSettings.mockResolvedValue(turnOptions);
    readTask.mockResolvedValue({
      ...source,
      status: "idle",
      turns: source.turns.map((turn) => ({ ...turn, status: "completed" })),
    });
    const listed = await app.inject({ method: "GET", url });
    const id = questionId(listed);
    const request = {
      method: "POST" as const,
      url: `${url}/${id}/answer`,
      headers: { "idempotency-key": "idle" },
      payload: { answers: ["  "] },
    };
    expect((await app.inject(request)).statusCode).toBe(400);
    const accepted = await app.inject({ ...request, payload: { answers: ["当前文件"] } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(startTurn).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ text: "范围\n当前文件" }),
      turnOptions,
    );
    expect(steerTurn).not.toHaveBeenCalled();
  });
  it("persists dismissals and keeps a newly repeated group visible after native ids change", async () => {
    const { app, readTask } = await setup();
    const listed = await app.inject({ method: "GET", url });
    const id = questionId(listed);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${url}/dismiss`,
          headers: { "idempotency-key": "dismiss" },
          payload: { ids: [id] },
        })
      ).statusCode,
    ).toBe(200);
    readTask.mockResolvedValue({
      ...source,
      turns: source.turns.map((turn, index) => ({
        ...turn,
        items:
          index === 0
            ? [
                { ...question, id: "snapshot-id" },
                { ...question, id: "new-id" },
              ]
            : [],
      })),
    });
    const refreshed = await app.inject({ method: "GET", url });
    expect(refreshed.json<{ data: AsyncQuestionGroup[] }>().data).toHaveLength(1);
    expect(refreshed.json<{ data: AsyncQuestionGroup[] }>().data[0]?.id).not.toBe(id);
  });
  it("accepts one bounded bulk dismissal beyond the former browser chunk size", async () => {
    const { app } = await setup();
    const id = questionId(await app.inject({ method: "GET", url }));
    const ids = [id, ...Array.from({ length: 128 }, (_, index) => `missing-${String(index)}`)];

    const response = await app.inject({
      method: "POST",
      url: `${url}/dismiss`,
      headers: { "idempotency-key": "bulk-dismiss" },
      payload: { ids },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ data: [] });
  });
  it("does not repeat a delivery with an unknown Provider outcome", async () => {
    const { app, steerTurn } = await setup();
    const listed = await app.inject({ method: "GET", url });
    const id = questionId(listed);
    const request = {
      method: "POST" as const,
      url: `${url}/${id}/answer`,
      headers: { "idempotency-key": "unknown" },
      payload: { answers: ["整个项目"] },
    };
    steerTurn.mockRejectedValueOnce(new Error("connection closed"));
    expect((await app.inject(request)).statusCode).toBe(409);
    expect((await app.inject(request)).json()).toMatchObject({
      code: "SUBMISSION_OUTCOME_UNKNOWN",
      retryable: false,
    });
    expect(steerTurn).toHaveBeenCalledOnce();
  });
  it("discovers paginated history once and checks task scope before exposing persisted questions", async () => {
    const { app, readTask } = await setup();
    const latest = {
      ...source,
      turns: source.turns.map((turn) => ({ ...turn, items: [] })),
      turnsNextCursor: "older",
    };
    readTask.mockImplementation((_id, input) =>
      Promise.resolve(
        input?.cursor === "older"
          ? { ...source, turns: source.turns.map((turn) => ({ ...turn, id: "old-turn" })) }
          : latest,
      ),
    );
    const id = questionId(await app.inject({ method: "GET", url }));
    expect(readTask).toHaveBeenCalledTimes(2);
    expect(questionId(await app.inject({ method: "GET", url }))).toBe(id);
    expect(readTask).toHaveBeenCalledTimes(3);
    readTask.mockResolvedValue({ ...source, projectId: "other" });
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${url}/${id}/answer`,
          headers: { "idempotency-key": "wrong-scope" },
          payload: { answers: ["整个项目"] },
        })
      ).statusCode,
    ).toBe(404);
  });
  it("allows only one Provider delivery across independent server instances", async () => {
    const first = await setup();
    const second = await createHarness({
      asyncQuestionRepository: await openRepository(first.root),
    });
    second.readTask.mockResolvedValue(source);
    const id = questionId(await first.app.inject({ method: "GET", url }));
    const request = {
      method: "POST" as const,
      url: `${url}/${id}/answer`,
      payload: { answers: ["整个项目"] },
    };
    const responses = await Promise.all([
      first.app.inject({ ...request, headers: { "idempotency-key": "first-window" } }),
      second.app.inject({ ...request, headers: { "idempotency-key": "second-window" } }),
    ]);
    expect(responses.some((response) => response.statusCode === 200)).toBe(true);
    expect(
      responses.every((response) => response.statusCode === 200 || response.statusCode === 409),
    ).toBe(true);
    expect(first.steerTurn.mock.calls.length + second.steerTurn.mock.calls.length).toBe(1);
  });
});
