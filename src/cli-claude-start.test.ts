import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { createCodexRuntimeProvider } from "@codexly/provider-codex";
import {
  createCodexlyServer,
  LocalProjectRepository,
  SqliteStateRepository,
} from "@codexly/server";
import { runCli } from "./cli-command.js";
import { createHarness, temporaryDirectories } from "./cli-command.test-support.js";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(
    () =>
      ({
        async *[Symbol.asyncIterator]() {
          yield await Promise.resolve({
            type: "result",
            subtype: "success",
            result: "done",
            is_error: false,
          });
        },
        supportedModels: () => Promise.resolve([{ value: "default", displayName: "Claude" }]),
        supportedCommands: () => Promise.resolve([]),
        accountInfo: () => Promise.resolve({ tokenSource: "none" }),
        close: vi.fn(),
      }) as unknown as Query,
  ),
  getSessionMessages: vi.fn(() => Promise.resolve([])),
  getSessionInfo: vi.fn(() => Promise.resolve(undefined)),
  deleteSession: vi.fn(() => Promise.resolve()),
}));

it("starts real HTTP, reads Claude history and chats while Codex is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "codexly-claude-start-"));
  temporaryDirectories.push(root);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude-user"));
  const store = await SqliteStateRepository.open(join(root, "state.sqlite3"));
  // 模拟已完成初始化的用户；引擎原生目录不参与启动和本地历史管理。
  await store.catalog("migration.import", { projects: [], tasks: [] });
  const projects = new LocalProjectRepository(store, store);
  const project = await projects.register({
    name: "Claude project",
    roots: [{ path: root }],
    idempotencyKey: "project",
  });
  let address: string | undefined;
  const harness = createHarness({
    createStateRepository: () => Promise.resolve(store),
    createProjectRepository: () => projects,
    createRuntimeProvider: createCodexRuntimeProvider,
    startCodexAppServer: vi.fn(() => Promise.reject(new Error("Codex executable unavailable"))),
    createServer: async (input) => {
      const app = await createCodexlyServer({ ...input, loggerEnabled: false });
      return {
        close: () => app.close(),
        listen: async () => {
          address = await app.listen({ host: "127.0.0.1", port: 0 });
          return address;
        },
      };
    },
  });
  const controller = new AbortController();
  const run = runCli(["start", "--no-open", "--codex-home", root], {
    ...harness.options,
    signal: controller.signal,
  });
  let historyPath = "";
  const request = async (path: string, payload?: unknown) => {
    const response = await fetch(
      `${address ?? ""}${path}`,
      payload === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
            body: JSON.stringify(payload),
          },
    );
    const body: unknown = await response.json();
    expect(response.ok, JSON.stringify({ path, body })).toBe(true);
    return body;
  };
  try {
    await vi.waitFor(() => {
      expect(address).toBeDefined();
    });
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
    await request("/v1/projects");
    const created = (await request(`/v1/projects/${project.id}/tasks`, { engine: "claude" })) as {
      task: { id: string };
    };
    const path = `/v1/projects/${project.id}/tasks/${created.task.id}`;
    historyPath = path;
    expect(await request(path)).toMatchObject({ snapshot: { engine: "claude" } });
    await request(`${path}/turns`, {
      input: { type: "prompt", text: "hello", attachments: [], skills: [] },
      options: {
        model: "default",
        reasoningEffort: "",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxMode: "workspace-write",
        engineOptions: { engine: "claude", permissionMode: "default" },
      },
    });
    await vi.waitFor(async () => {
      expect(await store.catalog("task.read", { id: created.task.id })).toMatchObject({
        status: "idle",
      });
    });
    expect(await request(path)).toMatchObject({
      snapshot: { engine: "claude", turns: [expect.objectContaining({ status: "completed" })] },
    });
    await request(`/v1/projects/${project.id}/tasks`);
    expect(query).toHaveBeenCalled();
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();

    // 用户显式读取 Codex 才尝试启动；失败只影响该请求，Claude 历史仍可用。
    expect((await fetch(`${address ?? ""}/v1/engines/codex`)).ok).toBe(false);
    expect(harness.dependencies.startCodexAppServer).toHaveBeenCalledOnce();
    expect(await request(path)).toMatchObject({ snapshot: { engine: "claude" } });
    expect(harness.dependencies.startCodexAppServer).toHaveBeenCalledOnce();

    // 修复 Codex 后直接重试，模型、认证与扩展继续通过原 Provider 路径提供。
    vi.mocked(harness.dependencies.startCodexAppServer).mockImplementation(() => {
      const exit = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
      return Promise.resolve({
        client: {
          ...harness.client,
          request: vi.fn((method: string) => {
            if (method === "config/read") return Promise.resolve({ config: {} });
            if (method === "account/read")
              return Promise.resolve({ account: null, requiresOpenaiAuth: false });
            if (method === "model/list")
              return Promise.resolve({
                data: [
                  {
                    model: "codex-test",
                    multiAgentVersion: "v2",
                    displayName: "Codex",
                    description: "",
                    hidden: false,
                    isDefault: true,
                    defaultReasoningEffort: "high",
                    supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }],
                  },
                ],
                nextCursor: null,
              });
            if (method === "skills/list") return Promise.resolve({ data: [] });
            if (method === "plugin/list") return Promise.resolve({ marketplaces: [] });
            if (method === "thread/search") return Promise.resolve({ data: [], nextCursor: null });
            throw new Error(`Unexpected RPC ${method}`);
          }),
        },
        close: () => {
          exit.resolve({ code: 0, signal: null });
          return Promise.resolve();
        },
        version: { version: "0.163.0", raw: "codex-cli 0.163.0" },
        waitForExit: () => exit.promise,
      });
    });
    expect(await request("/v1/engines/codex")).toMatchObject({
      engine: "codex",
      capabilities: { provider: "codex" },
      models: { data: [{ id: "codex-test" }] },
    });
    await request("/v1/skills/installed");
    await request("/v1/plugins/official");
    await request("/v1/search/tasks?query=hello&kind=history&archived=false");
    const codexTask = (await request(`/v1/projects/${project.id}/tasks`, { engine: "codex" })) as {
      task: { id: string };
    };
    expect(await store.catalog("task.read", { id: codexTask.task.id })).toMatchObject({
      provider: "codex",
    });
    expect(await request(path)).toMatchObject({ snapshot: { engine: "claude" } });
  } finally {
    controller.abort();
    await run;
  }
  await expect(run).resolves.toBe(0);

  // 重启后从真实 SQLite 与历史文件恢复，确保验收覆盖已有 Claude 用户。
  const restoredStore = await SqliteStateRepository.open(join(root, "state.sqlite3"));
  harness.dependencies.createStateRepository = () => Promise.resolve(restoredStore);
  harness.dependencies.createProjectRepository = () =>
    new LocalProjectRepository(restoredStore, restoredStore);
  harness.dependencies.startCodexAppServer = vi.fn(() =>
    Promise.reject(new Error("Codex unavailable after restart")),
  );
  address = undefined;
  const restartedController = new AbortController();
  const restarted = runCli(["start", "--no-open", "--codex-home", root], {
    ...harness.options,
    signal: restartedController.signal,
  });
  try {
    await vi.waitFor(() => {
      expect(address).toBeDefined();
    });
    expect(await request(historyPath)).toMatchObject({
      snapshot: { engine: "claude", turns: [expect.objectContaining({ status: "completed" })] },
    });
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
  } finally {
    restartedController.abort();
    await restarted;
  }
  await expect(restarted).resolves.toBe(0);
});
