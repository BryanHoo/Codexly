import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentTaskSnapshotResponse } from "@codexly/protocol";
import { createCliAcpRuntime } from "./cli-acp-runtime.js";
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

// SQLite Worker 与实际磁盘提交在并发测试中可能超过 vi.waitFor 默认的一秒。
const historySettlement = { timeout: 5_000, interval: 50 };

it.each(["codex", "claude"] as const)(
  "%s 的实际 HTTP/SQLite/ACP 装配在重启后沿原会话续聊",
  async (engine) => {
    const directory = await mkdtemp(join(tmpdir(), "cli-acp-integration-"));
    const projectRoot = join(directory, "project");
    const workspace = join(directory, "worktree");
    await mkdir(projectRoot);
    const git = promisify(execFile);
    await git("git", ["init", projectRoot]);
    await git("git", [
      "-C",
      projectRoot,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "init",
    ]);
    await git("git", ["-C", projectRoot, "worktree", "add", "-b", "test", workspace]);
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
        path: projectRoot,
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
          workspacePath: workspace,
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
      }, historySettlement);
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
          workspacePath: workspace,
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
        // 重启重放不能改变既有应用回合身份，否则搜索锚点和时间线引用会失效。
        expect(snapshot.turns[0]?.id).toBe(firstBody.turn.id);
        expect(snapshot.turns.map(({ status, error }) => ({ status, error }))).toEqual([
          { status: "completed", error: null },
          { status: "completed", error: null },
        ]);
      }, historySettlement);
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
      }, historySettlement);
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

it.each(["override", "codex", "claude"] as const)("Web 启动只迁移优先来源 %s", async (source) => {
  const directory = await mkdtemp(join(tmpdir(), "cli-acp-instructions-"));
  const codex = join(directory, "codex-home");
  const claude = join(directory, "claude-home");
  await Promise.all([mkdir(codex), mkdir(claude)]);
  const codexBody = "# Codex 旧指令\r\n  " + "保留".repeat(5000);
  const override = "Codex 临时覆盖\n";
  const claudeBody = "Claude 旧指令\n";
  const codexFile = join(codex, "AGENTS.md");
  const claudeFile = join(claude, "CLAUDE.md");
  await Promise.all([
    writeFile(codexFile, source === "claude" ? "  \n" : codexBody),
    writeFile(join(codex, "AGENTS.override.md"), source === "override" ? override : ""),
    writeFile(claudeFile, claudeBody),
  ]);
  const store = await SqliteStateRepository.open(join(directory, "state.sqlite3"));
  const baseline = {
    defaultAgent: "codex",
    defaultModel: null,
    commitMessagePrompt: "",
    taskTitlePrompt: "保留现有偏好",
    promptOptimizationPrompt: "",
    defaultOpenAppId: null,
    followUpBehavior: "queue",
    pet: { enabled: false, selectedPetId: null },
  } as const;
  const start = () =>
    createCliAcpRuntime({
      applicationDirectory: directory,
      store,
      environment: { CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude },
    });
  try {
    await store.catalog("app.preferences.patch", {
      baseline,
      changes: { followUpBehavior: "steer" },
    });
    await (await start()).close();
    const migrated = await store.catalog("app.preferences.read", {});
    expect(migrated?.taskTitlePrompt).toBe("保留现有偏好");
    expect(migrated?.followUpBehavior).toBe("steer");
    const expected = { override, codex: codexBody, claude: claudeBody }[source];
    expect(migrated?.globalInstructions).toBe(expected);
    expect(await readFile(codexFile, "utf8")).toBe(source === "claude" ? "  \n" : codexBody);
    expect(await readFile(claudeFile, "utf8")).toBe(claudeBody);

    await writeFile(join(codex, "AGENTS.override.md"), "后续改动");
    await (await start()).close();
    expect((await store.catalog("app.preferences.read", {}))?.globalInstructions).toBe(expected);

    await store.catalog("app.preferences.patch", { baseline, changes: { globalInstructions: "" } });
    await (await start()).close();
    expect((await store.catalog("app.preferences.read", {}))?.globalInstructions).toBe("");
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
