export const projects = [
  {
    createdAt: "2026-08-30T01:00:00.000Z",
    id: "codeagent",
    name: "CodeAgent",
    roots: [{ id: "root-codeagent", path: "/workspace/CodeAgent" }],
  },
  {
    createdAt: "2026-08-30T01:10:00.000Z",
    id: "codexly",
    name: "Codexly",
    roots: [{ id: "root-codexly", path: "/workspace/Codexly" }],
  },
] as const;

export const tasks = [
  {
    id: "stream-task",
    pinned: true,
    projectId: "codeagent",
    title: "验证流式消息",
    updatedAt: "2026-08-30T02:00:00.000Z",
  },
  {
    id: "approval-task",
    pinned: false,
    projectId: "codeagent",
    title: "处理命令审批",
    updatedAt: "2026-08-30T01:50:00.000Z",
  },
  {
    id: "git-task",
    pinned: false,
    projectId: "codeagent",
    title: "提交 Git 变更",
    updatedAt: "2026-08-30T01:40:00.000Z",
  },
  {
    id: "other-task",
    pinned: false,
    projectId: "codexly",
    title: "切换另一项目",
    updatedAt: "2026-08-30T01:30:00.000Z",
  },
  {
    id: "long-scroll-task",
    pinned: false,
    projectId: "codeagent",
    title: "推送GitHub打包，发布 GitHub Draft Release，本机gh可用",
    updatedAt: "2026-08-30T01:20:00.000Z",
  },
] as const;

export const modelPage = {
  data: [
    {
      defaultReasoningEffort: "high",
      description: "适合复杂编码任务",
      displayName: "GPT-5.6 Sol",
      id: "gpt-5.6-sol",
      isDefault: true,
      supportedReasoningEfforts: [
        { description: "快速回答", id: "low" },
        { description: "深入分析", id: "high" },
      ],
    },
  ],
  nextCursor: null,
} as const;

export const connectedProvider = {
  account: { type: "apiKey" },
  customBaseUrl: "https://gateway.test/v1",
  mode: "custom",
  pendingLogin: null,
  state: "connected",
} as const;

export const disconnectedProvider = {
  account: null,
  customBaseUrl: null,
  mode: "official",
  pendingLogin: null,
  state: "disconnected",
} as const;

export const settings = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  commitMessageModel: "gpt-5.6-sol",
  commitMessagePrompt: "",
  defaultOpenAppId: null,
  fastMode: false,
  followUpBehavior: "queue",
  model: "gpt-5.6-sol",
  pet: { enabled: false, selectedPetId: null },
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

export const projectDefaults = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  fastMode: false,
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

export const gitStatus = {
  baseBranches: ["main"],
  branch: "test/webview",
  branches: ["test/webview", "main"],
  repositoryMode: "root",
  snapshot: "a".repeat(64),
  staged: [],
  unstaged: [
    {
      diff: "--- a/src/main.tsx\n+++ b/src/main.tsx\n@@ -1 +1 @@\n-old\n+new",
      stats: { additions: 1, removals: 1 },
      kind: "update",
      path: "src/main.tsx",
    },
  ],
} as const;

const taskSettings = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

const baseSnapshot = {
  contextUsage: { contextWindow: 200_000, usedTokens: 4_000 },
  goal: null,
  pendingRequests: [],
  pinned: false,
  plan: null,
  projectId: "codeagent",
  settings: taskSettings,
  status: "idle",
  turns: [],
  turnsNextCursor: null,
  updatedAt: "2026-08-30T02:00:00.000Z",
} as const;

export function taskResponse(taskId: string) {
  const task = tasks.find((candidate) => candidate.id === taskId) ?? tasks[0];
  return {
    checkpoint: { sequence: 0, sessionId: `session-${task.id}` },
    snapshot: { ...baseSnapshot, ...task },
  };
}

export const streamTaskResponse = {
  checkpoint: { sequence: 0, sessionId: "session-stream-task" },
  snapshot: {
    ...baseSnapshot,
    ...tasks[0],
    status: "running",
    turns: [
      {
        completedAt: null,
        error: null,
        id: "turn-stream",
        items: [
          { id: "user-stream", role: "user", text: "开始流式输出", type: "message" },
          { id: "assistant-stream", role: "assistant", text: "", type: "message" },
        ],
        startedAt: "2026-08-30T02:00:00.000Z",
        status: "running",
      },
    ],
  },
} as const;

export const approvalRequest = {
  additionalPermissions: null,
  availableDecisions: ["deny", "allow_for_session", "allow"],
  command: "pnpm test:webview",
  createdAt: "2026-08-30T02:00:00.000Z",
  cwd: "/workspace/CodeAgent",
  expiresAt: null,
  itemId: "command-approval-item",
  networkAccess: null,
  projectId: "codeagent",
  reason: "运行原生 WebView 测试",
  requestId: "command-approval-1",
  status: "pending",
  taskId: "approval-task",
  turnId: "turn-approval",
  type: "command_approval",
} as const;

export const approvalTaskResponse = {
  checkpoint: { sequence: 0, sessionId: "session-approval-task" },
  snapshot: {
    ...baseSnapshot,
    ...tasks[1],
    pendingRequests: [approvalRequest],
    status: "running",
    turns: [
      {
        completedAt: null,
        error: null,
        id: "turn-approval",
        items: [{ command: "pnpm test:webview", cwd: "/workspace/CodeAgent", id: "command-1", outputOmitted: { bytes: 0, lines: 0 }, status: "running", type: "command" }],
        startedAt: "2026-08-30T02:00:00.000Z",
        status: "running",
      },
    ],
  },
} as const;

export const gitTaskResponse = {
  ...taskResponse("git-task"),
  snapshot: {
    ...taskResponse("git-task").snapshot,
    turns: [
      {
        completedAt: "2026-08-30T02:00:00.000Z",
        error: null,
        id: "turn-git",
        items: [
          { id: "user-git", role: "user", text: "更新入口", type: "message" },
          { changes: [{ ...gitStatus.unstaged[0], path: "/workspace/CodeAgent/src/main.tsx" }], id: "change-git", status: "completed", type: "file_change" },
        ],
        startedAt: "2026-08-30T01:55:00.000Z",
        status: "completed",
      },
    ],
  },
} as const;

const longColdTurnText = Array.from(
  { length: 120 },
  (_, index) => `冷 Turn 延迟布局段落 ${String(index + 1)}`,
).join("\n\n");
const longTaskItemCounts = [114, 85, 4, 85, 78] as const;

function createLongTaskItem(turnIndex: number, itemIndex: number, itemCount: number) {
  const itemId = `item-scroll-${String(turnIndex)}-${String(itemIndex)}`;
  if (itemIndex === 0) {
    return {
      id: itemId,
      role: "user",
      text: `滚动回归输入 ${String(turnIndex + 1)}`,
      type: "message",
    } as const;
  }
  if (itemIndex === itemCount - 1 || itemIndex % 6 === 0) {
    return {
      id: itemId,
      role: "assistant",
      text:
        turnIndex === longTaskItemCounts.length - 1 && itemIndex === itemCount - 1
          ? "最新回复标记"
          : longColdTurnText,
      type: "message",
    } as const;
  }
  if (itemIndex % 3 === 0) {
    return {
      id: itemId,
      text: `推理摘要 ${String(itemIndex)}\n\n${longColdTurnText}`,
      type: "reasoning",
    } as const;
  }
  return {
    command: `command-${String(itemIndex)}`,
    cwd: "/workspace/CodeAgent",
    exitCode: 0,
    id: itemId,
    output: longColdTurnText,
    outputOmitted: { bytes: 0, lines: 0 },
    status: "completed",
    type: "command",
  } as const;
}

export const longScrollTaskResponse = {
  checkpoint: { sequence: 0, sessionId: "session-long-scroll-task" },
  snapshot: {
    ...baseSnapshot,
    ...tasks[4],
    turns: longTaskItemCounts.map((itemCount, index) => ({
      completedAt: "2026-08-30T02:00:00.000Z",
      error: null,
      id: `turn-scroll-${String(index)}`,
      items: Array.from({ length: itemCount }, (_, itemIndex) =>
        createLongTaskItem(index, itemIndex, itemCount),
      ),
      startedAt: "2026-08-30T01:55:00.000Z",
      status: "completed",
    })),
  },
} as const;
