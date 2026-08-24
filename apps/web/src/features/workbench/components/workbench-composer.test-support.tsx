// 集中维护拆分测试共享的样本、mock 与生命周期钩子。
export const rootPath = "/workspace/Codexly";

export const task = {
  contextUsage: null,
  id: "task-1",
  pendingRequests: [],
  pinned: false,
  projectId: "codexly",
  settings: {
    approvalPolicy: "on-request" as const,
    approvalsReviewer: "user" as const,
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write" as const,
  },
  title: "新任务",
  updatedAt: "2026-07-23T00:00:00.000Z",
};

export const model = {
  defaultReasoningEffort: "high",
  description: "适合复杂编码任务",
  displayName: "GPT-5.6 Sol",
  id: "gpt-5.6-sol",
  isDefault: true,
  supportedReasoningEfforts: [
    { description: "快速回答", id: "low" },
    { description: "深入分析", id: "high" },
  ],
} as const;

export const turn = {
  completedAt: null,
  error: null,
  id: "turn-1",
  items: [],
  startedAt: "2026-07-23T00:00:00.000Z",
  status: "running" as const,
};
