import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  capabilitiesQueryOptions,
  type CodeAgentReadClient,
  modelsQueryOptions,
  projectDefaultsMutationOptions,
  projectDefaultsQueryOptions,
  projectCommitChangesMutationOptions,
  projectCommitMessageMutationOptions,
  projectReorderMutationOptions,
  projectTasksInfiniteQueryOptions,
  projectsQueryOptions,
  taskSnapshotQueryOptions,
  taskSettingsMutationOptions,
} from "./project-queries.js";
import { project, rootPath, task, snapshotResponse } from "./project-queries.test-support.js";

describe("project runtime queries", () => {
  it("loads projects, project tasks, and task snapshots through the client", async () => {
    const readTask = vi.fn<CodeAgentReadClient["readTask"]>(() =>
      Promise.resolve(snapshotResponse),
    );
    const client = {
      getCapabilities: vi.fn(() =>
        Promise.resolve({
          feedback: { upload: true },
          provider: "codex",
          skills: { list: true, use: true },
          tasks: { fork: true, list: true, read: true, start: true },
          turns: {
            compact: true,
            interrupt: true,
            review: true,
            start: true,
            steer: true,
          },
        }),
      ),
      getProjectDefaults: vi.fn(() =>
        Promise.resolve({
          settings: {
            approvalPolicy: "on-request" as const,
            approvalsReviewer: "user" as const,
            fastMode: false,
            model: "gpt-5.6-sol",
            reasoningEffort: "high",
            sandboxMode: "workspace-write" as const,
          },
        }),
      ),
      listProjects: vi.fn(() => Promise.resolve({ data: [project], nextCursor: null })),
      listModels: vi.fn(() =>
        Promise.resolve({
          data: [
            {
              defaultReasoningEffort: "high",
              description: "适合复杂编码任务",
              displayName: "GPT-5.6 Sol",
              id: "gpt-5.6-sol",
              isDefault: true,
              supportedReasoningEfforts: [{ description: "深入分析", id: "high" }],
            },
          ],
          nextCursor: null,
        }),
      ),
      listTasks: vi.fn(() => Promise.resolve({ data: [task], nextCursor: null })),
      readTask,
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(queryClient.fetchQuery(projectsQueryOptions(client))).resolves.toEqual({
      data: [project],
      nextCursor: null,
    });
    await expect(queryClient.fetchQuery(capabilitiesQueryOptions(client))).resolves.toMatchObject({
      feedback: { upload: true },
      tasks: { fork: true, start: true },
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        start: true,
        steer: true,
      },
    });
    await expect(queryClient.fetchQuery(modelsQueryOptions(client))).resolves.toMatchObject({
      data: [{ id: "gpt-5.6-sol", isDefault: true }],
    });
    await expect(
      queryClient.fetchQuery(projectDefaultsQueryOptions("code-agent", client)),
    ).resolves.toEqual({
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        fastMode: false,
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
    });
    await expect(
      queryClient.fetchInfiniteQuery(projectTasksInfiniteQueryOptions("code-agent", client)),
    ).resolves.toEqual({ pageParams: [undefined], pages: [{ data: [task], nextCursor: null }] });
    await expect(
      queryClient.fetchQuery(taskSnapshotQueryOptions("code-agent", "task-1", client)),
    ).resolves.toEqual(snapshotResponse);
    expect(readTask.mock.calls[0]?.slice(0, 2)).toEqual(["code-agent", "task-1"]);
    expect(readTask.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("updates complete project defaults and task settings through mutations", async () => {
    const defaults = {
      approvalPolicy: "never" as const,
      approvalsReviewer: "user" as const,
      fastMode: true,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write" as const,
    };
    const settings = {
      approvalPolicy: defaults.approvalPolicy,
      approvalsReviewer: defaults.approvalsReviewer,
      model: defaults.model,
      reasoningEffort: defaults.reasoningEffort,
      sandboxMode: defaults.sandboxMode,
    };
    const client = {
      updateProjectDefaults: vi.fn(() => Promise.resolve({ settings: defaults })),
      updateTaskSettings: vi.fn(() => Promise.resolve({ settings })),
    };
    const queryClient = new QueryClient();

    const defaultsMutationOptions = projectDefaultsMutationOptions("code-agent", client);
    const taskMutationOptions = taskSettingsMutationOptions("code-agent", "task-1", client);

    await queryClient
      .getMutationCache()
      .build(queryClient, defaultsMutationOptions)
      .execute(defaults);
    await queryClient.getMutationCache().build(queryClient, taskMutationOptions).execute(settings);

    expect(client.updateProjectDefaults).toHaveBeenCalledWith("code-agent", defaults);
    expect(client.updateTaskSettings).toHaveBeenCalledWith("code-agent", "task-1", settings);
    expect(defaultsMutationOptions.meta).toEqual({
      actionNotification: { successMessage: false },
    });
    expect(taskMutationOptions.meta).toEqual({
      actionNotification: { successMessage: false },
    });
  });

  it("sends the complete project order through a serialized mutation", async () => {
    const reorderProjects = vi.fn(() => Promise.resolve({ data: [project], nextCursor: null }));
    const queryClient = new QueryClient();
    const mutationOptions = projectReorderMutationOptions({ reorderProjects });

    await queryClient.getMutationCache().build(queryClient, mutationOptions).execute([project.id]);

    expect(reorderProjects).toHaveBeenCalledWith([project.id]);
    expect(mutationOptions.scope).toEqual({ id: "projects:reorder" });
  });

  it("generates and commits selected Git paths through project-scoped mutations", async () => {
    const messageRequest = { expectedSnapshot: "a".repeat(64), paths: ["src/app.ts"] };
    const commitRequest = {
      action: "commit" as const,
      expectedSnapshot: "a".repeat(64),
      message: "feat(git): 提交选择文件",
      paths: ["src/app.ts"],
    };
    const client = {
      commitProjectChanges: vi.fn(() =>
        Promise.resolve({
          branch: "feat/commit",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          message: commitRequest.message,
          pushError: null,
          pushStatus: "not_requested" as const,
        }),
      ),
      generateCommitMessage: vi.fn(() =>
        Promise.resolve({
          message: commitRequest.message,
          snapshot: messageRequest.expectedSnapshot,
        }),
      ),
    };
    const queryClient = new QueryClient();
    const messageOptions = projectCommitMessageMutationOptions("code-agent", rootPath, client);
    const commitOptions = projectCommitChangesMutationOptions("code-agent", rootPath, client);

    await queryClient.getMutationCache().build(queryClient, messageOptions).execute(messageRequest);
    await queryClient.getMutationCache().build(queryClient, commitOptions).execute(commitRequest);

    expect(client.generateCommitMessage).toHaveBeenCalledWith(
      "code-agent",
      rootPath,
      messageRequest,
    );
    expect(client.commitProjectChanges).toHaveBeenCalledWith("code-agent", rootPath, commitRequest);
    expect(messageOptions.scope).toEqual({ id: `project-git-message:code-agent:${rootPath}` });
    expect(commitOptions.scope).toEqual({ id: `project-git-mutation:code-agent:${rootPath}` });
  });
});
