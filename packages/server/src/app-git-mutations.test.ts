import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { createCodeAgentServer } from "./app.js";
import {
  projectRootPath,
  encodedProjectRootPath,
  modelPage,
  closeCallbacks,
  createProvider,
  createSettingsRepository,
  createServerOptions,
} from "./app-all.test-support.js";

describe("server Git mutations", () => {
  it("generates a selected-file commit message through an ephemeral read-only turn", async () => {
    const providerHarness = createProvider();
    const settings = createSettingsRepository();
    providerHarness.listModels.mockResolvedValue({
      data: [
        ...modelPage.data,
        {
          defaultReasoningEffort: "medium",
          description: "适合日常任务",
          displayName: "GPT-5.6 Terra",
          id: "gpt-5.6-terra",
          isDefault: false,
          supportedReasoningEfforts: [
            { description: "低", id: "low" },
            { description: "中", id: "medium" },
          ],
        },
      ],
      nextCursor: null,
    });
    settings.readGlobalSettings.mockResolvedValue({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      commitMessageModel: "gpt-5.6-terra",
      commitMessagePrompt: "优先说明行为变化，不要罗列文件名。",
      defaultOpenAppId: null,
      fastMode: false,
      followUpBehavior: "queue",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
    const snapshot = "a".repeat(64);
    const readProjectGitStatus = vi.fn(() =>
      Promise.resolve({
        baseBranches: ["main"],
        branch: "feat/commit",
        branches: ["feat/commit", "main"],
        repositoryMode: "root" as const,
        snapshot,
        staged: [],
        unstaged: [
          {
            diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
            kind: "update" as const,
            path: "src/app.ts",
          },
        ],
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, {
        readProjectGitStatus,
        settingsRepository: settings.repository,
      }),
    );
    closeCallbacks.push(() => app.close());

    const responsePromise = app.inject({
      headers: { "idempotency-key": "generate-message" },
      method: "POST",
      payload: {
        expectedSnapshot: snapshot,
        paths: ["src/app.ts"],
        repository: "frontend",
      },
      url: `/v1/projects/code-agent/git/commit-message?rootPath=${encodedProjectRootPath}`,
    });
    await vi.waitFor(() => {
      expect(providerHarness.startTurn).toHaveBeenCalledOnce();
    });
    providerHarness.emitEvent({
      itemId: "message-1",
      payload: {
        item: {
          id: "message-1",
          role: "assistant",
          text: JSON.stringify({ message: "feat(git): 生成提交信息" }),
          type: "message",
        },
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "item.completed",
    });
    providerHarness.emitEvent({
      payload: {
        turn: {
          completedAt: "2026-08-01T00:00:01.000Z",
          error: null,
          id: "turn-1",
          items: [],
          startedAt: "2026-08-01T00:00:00.000Z",
          status: "completed",
        },
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "turn.completed",
    });
    const response = await responsePromise;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "feat(git): 生成提交信息", snapshot });
    expect(readProjectGitStatus).toHaveBeenCalledWith(projectRootPath, {
      includeDiff: true,
      repository: "frontend",
    });
    expect(providerHarness.startTask).toHaveBeenCalledWith({ ephemeral: true });
    const startTurnCall = providerHarness.startTurn.mock.calls[0];
    expect(startTurnCall?.[0]).toBe("task-1");
    expect(startTurnCall?.[1].outputSchema).toMatchObject({ type: "object" });
    expect(startTurnCall?.[1].text).toContain(
      "Generate the commit message only from the exact Git diff in this prompt. Do not read files or run commands.",
    );
    expect(startTurnCall?.[1].text).toContain("Current branch: feat/commit");
    expect(startTurnCall?.[1].text).toContain(
      "<selected-diff>\n\n[unstaged] src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n\n</selected-diff>",
    );
    expect(startTurnCall?.[1].text).toContain(
      "<user-preferences>\n优先说明行为变化，不要罗列文件名。\n</user-preferences>",
    );
    expect(startTurnCall?.[1].text).toContain(
      "The following user preferences define the commit message format and language.",
    );
    expect(startTurnCall?.[1].text).not.toContain("Conventional Commits");
    expect(startTurnCall?.[1].text).not.toContain("简体中文");
    expect(startTurnCall?.[1].text).not.toContain("scope 必填");
    expect(startTurnCall?.[2]).toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      sandboxMode: "read-only",
    });
    expect(providerHarness.archiveTask).not.toHaveBeenCalled();
    expect(providerHarness.unsubscribeTask).toHaveBeenCalledWith("task-1");
  });

  it("rejects stale commit-message snapshots before starting Codex", async () => {
    const providerHarness = createProvider();
    const readProjectGitStatus = vi.fn(() =>
      Promise.resolve({
        baseBranches: ["main"],
        branch: "feat/commit",
        branches: ["feat/commit", "main"],
        repositoryMode: "root" as const,
        snapshot: "d".repeat(64),
        staged: [],
        unstaged: [{ diff: "+new", kind: "update" as const, path: "src/app.ts" }],
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, { readProjectGitStatus }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      headers: { "idempotency-key": "stale-message" },
      method: "POST",
      payload: { expectedSnapshot: "e".repeat(64), paths: ["src/app.ts"] },
      url: `/v1/projects/code-agent/git/commit-message?rootPath=${encodedProjectRootPath}`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "GIT_STATUS_CHANGED" });
    expect(providerHarness.startTask).not.toHaveBeenCalled();
  });

  it("uses bounded change summaries and diff excerpts for oversized commit-message input", async () => {
    const providerHarness = createProvider();
    const snapshot = "f".repeat(64);
    const oversizedChanges = Array.from({ length: 120 }, (_, index) => {
      const path = `src/file-${String(index).padStart(3, "0")}.ts`;
      return {
        diff: [
          `diff --git a/${path} b/${path}`,
          `--- a/${path}`,
          `+++ b/${path}`,
          "@@ -1 +1 @@",
          `-old behavior ${String(index)}`,
          `+new behavior ${String(index)}`,
          `+${index === 0 ? "x".repeat(70_000) : "x".repeat(600)}`,
          ...(index === 0 ? ["+END_OF_LARGE_DIFF"] : []),
        ].join("\n"),
        kind: "update" as const,
        path,
      };
    });
    const readProjectGitStatus = vi.fn(() =>
      Promise.resolve({
        baseBranches: ["main"],
        branch: "feat/commit",
        branches: ["feat/commit", "main"],
        repositoryMode: "root" as const,
        snapshot,
        staged: [],
        unstaged: oversizedChanges,
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, { readProjectGitStatus }),
    );
    closeCallbacks.push(() => app.close());

    const responsePromise = app.inject({
      headers: { "idempotency-key": "failed-message" },
      method: "POST",
      payload: { expectedSnapshot: snapshot, paths: oversizedChanges.map((change) => change.path) },
      url: `/v1/projects/code-agent/git/commit-message?rootPath=${encodedProjectRootPath}`,
    });
    await vi.waitFor(() => {
      expect(providerHarness.startTurn).toHaveBeenCalledOnce();
    });
    const prompt = providerHarness.startTurn.mock.calls[0]?.[1].text;
    expect(prompt).toContain(
      "Generate the commit message only from the following change summary and representative diff excerpts.",
    );
    expect(prompt).toContain("Do not read files or run commands.");
    expect(prompt).toContain("[unstaged] update src/file-000.ts (+3 -1");
    expect(prompt).toContain("[unstaged] update src/file-119.ts (+2 -1");
    expect(prompt).toContain("<selected-diff-excerpts>");
    expect(prompt).toContain("+new behavior 0");
    expect(prompt).toContain("+new behavior 119");
    expect(prompt).toContain("END_OF_LARGE_DIFF");
    expect(prompt).not.toContain("<selected-diff>");
    expect(prompt).not.toMatch(/[\u3400-\u9fff]/u);
    expect(Buffer.byteLength(prompt ?? "", "utf8")).toBeLessThanOrEqual(70 * 1_024);
    providerHarness.emitEvent({
      payload: { message: "model failed", willRetry: false },
      taskId: "task-1",
      turnId: "turn-1",
      type: "provider.error",
    });
    const response = await responsePromise;

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: "COMMIT_MESSAGE_GENERATION_FAILED" });
    expect(providerHarness.interruptTurn).toHaveBeenCalledWith("task-1", "turn-1");
    expect(providerHarness.archiveTask).not.toHaveBeenCalled();
    expect(providerHarness.unsubscribeTask).toHaveBeenCalledWith("task-1");
  });

  it("commits selected files idempotently and preserves push partial success", async () => {
    const { provider } = createProvider();
    const snapshot = "b".repeat(64);
    const commitProjectChanges = vi.fn(() =>
      Promise.resolve({
        branch: "feat/commit",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        message: "feat(git): 提交选择文件",
        pushError: "fatal: remote rejected",
        pushStatus: "failed" as const,
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { commitProjectChanges }),
    );
    closeCallbacks.push(() => app.close());
    const request = {
      action: "commit_and_push",
      expectedSnapshot: snapshot,
      message: "feat(git): 提交选择文件",
      paths: ["src/app.ts"],
    } as const;

    const first = await app.inject({
      headers: { "idempotency-key": "commit-selected" },
      method: "POST",
      payload: request,
      url: `/v1/projects/code-agent/git/commits?rootPath=${encodedProjectRootPath}`,
    });
    const repeated = await app.inject({
      headers: { "idempotency-key": "commit-selected" },
      method: "POST",
      payload: request,
      url: `/v1/projects/code-agent/git/commits?rootPath=${encodedProjectRootPath}`,
    });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ pushStatus: "failed" });
    expect(repeated.json()).toEqual(first.json());
    expect(commitProjectChanges).toHaveBeenCalledOnce();
    expect(commitProjectChanges).toHaveBeenCalledWith(projectRootPath, request);
  });

  it("rejects concurrent Git mutations for the same project", async () => {
    const { provider } = createProvider();
    let resolveCommit!: (result: {
      branch: string;
      commitSha: string;
      message: string;
      pushError: null;
      pushStatus: "not_requested";
    }) => void;
    const commitProjectChanges = vi.fn(
      () =>
        new Promise<{
          branch: string;
          commitSha: string;
          message: string;
          pushError: null;
          pushStatus: "not_requested";
        }>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { commitProjectChanges }),
    );
    closeCallbacks.push(() => app.close());
    const payload = {
      action: "commit",
      expectedSnapshot: "1".repeat(64),
      message: "feat(git): 提交选择文件",
      paths: ["src/app.ts"],
    } as const;

    const firstResponse = app.inject({
      headers: { "idempotency-key": "first-commit" },
      method: "POST",
      payload,
      url: `/v1/projects/code-agent/git/commits?rootPath=${encodedProjectRootPath}`,
    });
    await vi.waitFor(() => {
      expect(commitProjectChanges).toHaveBeenCalledOnce();
    });
    const concurrentResponse = await app.inject({
      headers: { "idempotency-key": "concurrent-commit" },
      method: "POST",
      payload,
      url: `/v1/projects/code-agent/git/commits?rootPath=${encodedProjectRootPath}`,
    });
    resolveCommit({
      branch: "feat/commit",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      message: payload.message,
      pushError: null,
      pushStatus: "not_requested",
    });

    expect(concurrentResponse.statusCode).toBe(409);
    expect(concurrentResponse.json()).toMatchObject({ code: "GIT_MUTATION_IN_PROGRESS" });
    expect((await firstResponse).statusCode).toBe(201);
    expect(commitProjectChanges).toHaveBeenCalledOnce();
  });
});
