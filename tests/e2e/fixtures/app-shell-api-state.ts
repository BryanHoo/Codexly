import {
  models,
  projectGitStatus,
  projectGitWorktrees,
  projects,
  taskSnapshot,
  tasks,
} from "./app-shell-data.js";

export interface FixtureQueuedSubmission {
  attachments: readonly Readonly<{
    id: string;
    kind: "file";
    mediaType: "text/plain";
    name: string;
    size: number;
  }>[];
  clientUserMessageId: string;
  id: string;
  skills: readonly Readonly<{ id: string; name: string }>[];
  text: string;
}

// 每个 Page 创建独立状态，避免 E2E 用例之间共享可变数据。
export function createAppShellApiState(options: Readonly<{ providerConnected?: boolean }>) {
  const routedProjects = [...projects];
  const routedTasks = tasks.map((task) => ({ ...task }));
  const temporaryTasks: (typeof tasks)[number][] = [];
  const temporaryTurns = new Map<string, (typeof taskSnapshot.turns)[number][]>();
  const routedProjectGitStatus = { ...projectGitStatus };
  const routedProjectGitWorktrees = [...projectGitWorktrees];
  const projectDefaults = new Map(
    projects.map((project) => [
      project.id,
      {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        fastMode: false,
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
    ]),
  );
  const taskSettings = new Map([
    ["code-agent:task-1", taskSnapshot.settings],
    ["code-agent:task-2", taskSnapshot.settings],
  ]);
  const globalSettings = {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    commitMessageModel: "gpt-5.6-sol",
    commitMessagePrompt: "",
    defaultOpenAppId: "zed" as string | null,
    fastMode: false,
    followUpBehavior: "queue" as "queue" | "steer",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  };
  const providerStatus = {
    account: options.providerConnected === false ? null : ({ type: "apiKey" } as const),
    customBaseUrl: null as string | null,
    mode: "official" as "custom" | "official",
    pendingLogin: null as null | {
      error: string | null;
      loginId: string;
      state: "failed" | "pending";
    },
    state: (options.providerConnected === false ? "disconnected" : "connected") as
      "connected" | "disconnected" | "failed" | "pending",
  };
  const routedModels = models;
  const nextQueuedSubmission = 1;
  const queuedSubmissionsByTask = new Map<string, FixtureQueuedSubmission[]>();
  return {
    routedProjects,
    routedTasks,
    temporaryTasks,
    temporaryTurns,
    routedProjectGitStatus,
    routedProjectGitWorktrees,
    projectDefaults,
    taskSettings,
    globalSettings,
    providerStatus,
    routedModels,
    nextQueuedSubmission,
    queuedSubmissionsByTask,
  };
}

export type AppShellApiState = ReturnType<typeof createAppShellApiState>;
