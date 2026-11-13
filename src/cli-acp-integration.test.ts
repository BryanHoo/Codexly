import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTaskSnapshotResponse } from "@codexly/protocol";
import { AcpApplicationRuntime } from "@codexly/provider-acp";
import { createPersistentAgentPeer } from "../packages/provider-acp/test/persistent-agent.test-support.js";
import {
  createCodexlyServer,
  SqliteStateRepository,
  LocalProjectRepository,
} from "@codexly/server";
import {
  createProvider,
  createServerOptions,
} from "../packages/server/src/app-all.test-support.js";

it.each(["codex", "claude"] as const)(
  "%s 的实际 HTTP/SQLite/ACP 装配在重启后沿原会话续聊",
  async (engine) => {
    const directory = await mkdtemp(join(tmpdir(), "cli-acp-integration-"));
    const workspace = join(directory, "project");
    await mkdir(workspace);
    const { launch, loaded, prompts, transcripts } = createPersistentAgentPeer();
    async function open() {
      const store = await SqliteStateRepository.open(join(directory, "state.sqlite3"));
      const runtime = new AcpApplicationRuntime(
        join(directory, "engines", "acp"),
        store,
        () => Promise.resolve({ defaultAgent: engine, defaultModel: "model-a" }),
        launch,
      );
      // HTTP、任务运行时及提交仓储均使用真实实现；只替换外部 agent 与无关宿主功能。
      const app = await createCodexlyServer({
        ...createServerOptions(createProvider().provider),
        provider: runtime,
        projectRepository: new LocalProjectRepository(store, store),
        localCatalogStore: store,
        settingsRepository: store,
        submissionRepository: store,
        queueRepository: store,
      });
      return {
        app,
        store,
        runtime,
        close: async () => {
          await app.close();
          await runtime.close();
          await store.close();
        },
      };
    }
    let current: Awaited<ReturnType<typeof open>> | undefined;
    try {
      current = await open();
      await current.store.catalog("project.put", {
        id: "project",
        path: workspace,
        name: "项目",
        createdAt: new Date().toISOString(),
      });
      // 旧应用任务尚无 ACP 缓存，必须按原生 ID 加载历史，不能另建模型会话替代。
      transcripts.set("external-old", [
        { user: true, text: "旧问题" },
        { user: false, text: "旧回答" },
      ]);
      await current.store.catalog("task.put", {
        id: "legacy-task",
        provider: engine,
        projectId: "project",
        sessionId: "external-old",
        cwd: workspace,
        title: "旧标题",
        pinned: true,
        archived: false,
        status: "idle",
        updatedAt: 0,
      });
      const old = await current.app.inject({
        method: "GET",
        url: "/v1/projects/project/tasks/legacy-task",
      });
      expect(old.statusCode, old.body).toBe(200);
      expect(old.body).toContain("旧回答");
      const first = await current.app.inject({
        method: "POST",
        url: "/v1/projects/project/submissions",
        headers: { "idempotency-key": "first" },
        payload: {
          type: "acp-prompt",
          engine,
          input: { type: "prompt", text: "第一条", attachments: [], skills: [] },
        },
      });
      expect(first.statusCode, first.body).toBe(201);
      const firstBody = first.json<{ taskId: string; turn: { id: string } }>();
      const taskId = firstBody.taskId;
      const running = current;
      await vi.waitFor(async () => {
        const response = await running.app.inject({
          method: "GET",
          url: `/v1/projects/project/tasks/${taskId}`,
        });
        expect(response.json<AgentTaskSnapshotResponse>().snapshot.turns[0]?.status).toBe(
          "completed",
        );
      });
      const binding = await current.store.catalog("task.read", { id: taskId });
      expect(binding?.provider).toBe(engine);
      expect(binding?.sessionId).toBeTruthy();
      await current.close();
      current = undefined;
      current = await open();
      const resumed = current;
      const repeated = await current.app.inject({
        method: "POST",
        url: "/v1/projects/project/submissions",
        headers: { "idempotency-key": "first" },
        payload: {
          type: "acp-prompt",
          engine,
          input: { type: "prompt", text: "第一条", attachments: [], skills: [] },
        },
      });
      expect(repeated.statusCode, repeated.body).toBe(201);
      const repeatedBody = repeated.json<{ taskId: string; turn: { id: string } }>();
      expect(repeatedBody.taskId).toBe(taskId);
      expect(repeatedBody.turn.id).toBe(firstBody.turn.id);
      const second = await current.app.inject({
        method: "POST",
        url: "/v1/projects/project/submissions",
        headers: { "idempotency-key": "second" },
        payload: {
          type: "acp-prompt",
          taskId,
          input: { type: "prompt", text: "第二条", attachments: [], skills: [] },
        },
      });
      expect(second.statusCode, second.body).toBe(201);
      await vi.waitFor(async () => {
        const response = await resumed.app.inject({
          method: "GET",
          url: `/v1/projects/project/tasks/${taskId}`,
        });
        const snapshot = response.json<AgentTaskSnapshotResponse>().snapshot;
        expect(snapshot.turns).toHaveLength(2);
        expect(
          snapshot.turns.every((turn: { status: string }) => turn.status === "completed"),
        ).toBe(true);
      });
      expect((await current.store.catalog("task.read", { id: taskId }))?.sessionId).toBe(
        binding?.sessionId,
      );
      expect(loaded).toContain(binding?.sessionId);
      expect(prompts.filter((text) => text === "第一条")).toHaveLength(1);
      expect(prompts.filter((text) => text === "第二条")).toHaveLength(1);
      const continued = await current.app.inject({
        method: "POST",
        url: "/v1/projects/project/submissions",
        headers: { "idempotency-key": "legacy-continue" },
        payload: {
          type: "acp-prompt",
          taskId: "legacy-task",
          input: { type: "prompt", text: "旧任务续聊", attachments: [], skills: [] },
        },
      });
      expect(continued.statusCode, continued.body).toBe(201);
      await vi.waitFor(async () => {
        const response = await resumed.app.inject({
          method: "GET",
          url: "/v1/projects/project/tasks/legacy-task",
        });
        const snapshot = response.json<AgentTaskSnapshotResponse>().snapshot;
        expect(snapshot.turns).toHaveLength(2);
        expect(snapshot.turns[1]?.status).toBe("completed");
        expect(response.body).toContain("旧回答");
      });
      expect(await current.store.catalog("task.read", { id: "legacy-task" })).toMatchObject({
        sessionId: "external-old",
        title: "旧标题",
        pinned: true,
      });
    } finally {
      await current?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
