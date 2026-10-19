import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  encodedProjectRootPath,
  modelPage,
  snapshot,
  task,
} from "./app-all.test-support.js";
import { type AgentGlobalSettingsResponse, DEFAULT_CLAUDE_SETTINGS } from "@codexly/protocol";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

async function setup() {
  const harness = createProvider();
  harness.listModels.mockRejectedValue(new Error("Codex unavailable"));
  const repository = await openRepository(await createWorkspace());
  const provider = {
    ...harness.provider,
    readTaskMetadata: () => Promise.resolve({ ...task, engine: "claude" as const }),
  };
  const options = createServerOptions(provider, {
    preloadModelCatalog: false,
    settingsRepository: repository,
    asyncQuestionRepository: repository,
    readProjectGitStatus: () =>
      Promise.resolve({
        baseBranches: [],
        branch: "main",
        branches: ["main"],
        repositoryMode: "root",
        snapshot: "a".repeat(64),
        staged: [],
        unstaged: [{ path: "proof.txt", kind: "create", diff: "+proof" }],
      }),
  });
  const generateCommitMessage = vi.fn(() => Promise.resolve("feat(test): 添加验证文件"));
  options.provider = {
    ...options.provider,
    engines: {
      claude: {
        inspect: async () => ({
          engine: "claude" as const,
          models: { ...modelPage, data: [...modelPage.data] },
          capabilities: { ...(await harness.provider.getCapabilities()), provider: "claude" },
          commands: [],
          connection: {
            mode: "official" as const,
            state: "connected" as const,
            account: null,
            pendingLogin: null,
            customBaseUrl: null,
          },
        }),
        readSettings: () => Promise.resolve(DEFAULT_CLAUDE_SETTINGS),
        writeSettings: vi.fn(),
        configure: vi.fn(),
        disconnect: vi.fn(),
        generateCommitMessage,
      },
    },
  };
  const app = await createCodexlyServer(options);
  closeCallbacks.push(() => app.close());
  return { app, harness, generateCommitMessage, repository };
}

it("reads and saves application preferences without querying Codex", async () => {
  const { app, harness } = await setup();
  const response = await app.inject({ method: "GET", url: "/v1/settings?engine=claude" });
  expect(response.statusCode, response.body).toBe(200);
  const settings = {
    ...response.json<AgentGlobalSettingsResponse>().settings,
    followUpBehavior: "steer",
  };
  const saved = await app.inject({
    method: "PUT",
    url: "/v1/settings?engine=claude",
    headers: { "idempotency-key": "claude-settings" },
    payload: settings,
  });
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json<AgentGlobalSettingsResponse>().settings.followUpBehavior).toBe("steer");
  expect(harness.listModels).not.toHaveBeenCalled();
});

it("answers idle Claude questions using its own models when Codex is unavailable", async () => {
  const { app, harness, repository } = await setup();
  const turn = {
    id: "question-turn",
    status: "running" as const,
    startedAt: snapshot.updatedAt,
    completedAt: null,
    error: null,
    items: [
      {
        id: "question-item",
        type: "message" as const,
        role: "assistant" as const,
        text: "选择范围",
        questions: [{ title: "范围", options: ["当前文件", "整个项目"] }],
      },
    ],
  };
  harness.readTask.mockResolvedValue({
    ...snapshot,
    engine: "claude",
    status: "running",
    turns: [turn],
  });
  const url = "/v1/projects/codexly/tasks/task-1/async-questions";
  const listed = await app.inject({ method: "GET", url });
  expect(listed.statusCode, listed.body).toBe(200);
  const id = listed.json<{ data: { id: string }[] }>().data[0]?.id;
  harness.readTask.mockResolvedValue({
    ...snapshot,
    engine: "claude",
    status: "idle",
    turns: [{ ...turn, status: "completed" }],
  });
  const model = modelPage.data[0];
  if (!model || !id) throw new Error("Missing Claude fixture");
  await repository.writeTaskSettings("codexly", "task-1", {
    model: model.id,
    reasoningEffort: model.defaultReasoningEffort,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxMode: "workspace-write",
    engineOptions: { engine: "claude", permissionMode: "default" },
  });
  const answer = await app.inject({
    method: "POST",
    url: `${url}/${id}/answer`,
    headers: { "idempotency-key": "claude-answer" },
    payload: { answers: ["当前文件"] },
  });
  expect(answer.statusCode, answer.body).toBe(200);
  expect(harness.startTurn).toHaveBeenCalledOnce();
  expect(harness.listModels).not.toHaveBeenCalled();
});

it("generates Git commit messages with Claude while Codex is unavailable", async () => {
  const { app, harness, generateCommitMessage } = await setup();
  const response = await app.inject({
    method: "POST",
    url: `/v1/projects/codexly/git/commit-message?rootPath=${encodedProjectRootPath}`,
    headers: { "idempotency-key": "claude-commit" },
    payload: { engine: "claude", expectedSnapshot: "a".repeat(64), paths: ["proof.txt"] },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json<{ message: string }>().message).toBe("feat(test): 添加验证文件");
  expect(generateCommitMessage).toHaveBeenCalledOnce();
  expect(harness.listModels).not.toHaveBeenCalled();
  expect(harness.startTask).not.toHaveBeenCalled();
});

it("uses the configured application agent and model instead of the request engine", async () => {
  const { app, harness, repository, generateCommitMessage } = await setup();
  const loaded = await app.inject({ method: "GET", url: "/v1/settings?engine=claude" });
  await repository.writeGlobalSettings({
    ...loaded.json<AgentGlobalSettingsResponse>().settings,
    defaultAgent: "claude",
    defaultModel: "custom-haiku",
  });
  const response = await app.inject({
    method: "POST",
    url: `/v1/projects/codexly/git/commit-message?rootPath=${encodedProjectRootPath}`,
    headers: { "idempotency-key": "application-claude-commit" },
    payload: { engine: "codex", expectedSnapshot: "a".repeat(64), paths: ["proof.txt"] },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(generateCommitMessage).toHaveBeenCalledWith(expect.any(String), "custom-haiku");
  expect(harness.listModels).not.toHaveBeenCalled();
});
