// 集中维护拆分测试共享的样本、mock 与生命周期钩子。
export const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  rootPath: "/workspace/CodeAgent",
  roots: [{ id: "root-code-agent", path: "/workspace/CodeAgent" }],
} as const;

export const rootPath = "/workspace/CodeAgent";

export const task = {
  id: "task-1",
  pinned: false,
  projectId: "code-agent",
  title: "结构化历史",
  updatedAt: "2026-07-23T00:01:00.000Z",
} as const;

export const snapshot = {
  ...task,
  contextUsage: null,
  plan: null,
  pendingRequests: [],
  settings: {
    approvalPolicy: "never" as const,
    approvalsReviewer: "user" as const,
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write" as const,
  },
  status: "idle" as const,
  turns: [
    {
      completedAt: "2026-07-23T00:01:00.000Z",
      error: "模型服务不可用",
      id: "turn-1",
      items: [
        { id: "i1", role: "user" as const, text: "读取真实历史", type: "message" as const },
        {
          content: "按统一边界实现",
          id: "i2",
          summary: "分析协议",
          type: "reasoning" as const,
        },
        {
          command: "pnpm check",
          cwd: "/workspace/CodeAgent",
          id: "i3",
          output: "Done",
          outputTruncated: true,
          status: "completed" as const,
          type: "command" as const,
        },
        {
          changes: [{ diff: "+export {};", kind: "update" as const, path: "src/index.ts" }],
          id: "i4",
          status: "completed" as const,
          type: "file_change" as const,
        },
        {
          id: "i5",
          input: { path: "src/index.ts" },
          name: "filesystem/read_file",
          status: "completed" as const,
          type: "tool" as const,
        },
        { id: "i6", text: "1. 定义协议", type: "plan" as const },
        { detail: "完成压缩", id: "i7", label: "上下文压缩", type: "activity" as const },
      ],
      startedAt: "2026-07-23T00:00:00.000Z",
      status: "failed" as const,
    },
  ],
  turnsNextCursor: null,
};

export const snapshotResponse = {
  checkpoint: { sequence: 0, sessionId: "runtime-1" },
  snapshot,
};
