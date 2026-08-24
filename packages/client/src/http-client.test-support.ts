import type { PendingRequest } from "@code-agent/protocol";

// 集中维护 HTTP client 的协议响应样本与 JSON 工具。
export const task = {
  id: "task-1",
  pinned: false,
  projectId: "code-agent",
  title: "结构化历史",
  updatedAt: "2026-07-23T00:01:00.000Z",
};

export const taskSettings = {
  approvalPolicy: "never" as const,
  approvalsReviewer: "user" as const,
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write" as const,
};

export const projectDefaults = {
  approvalPolicy: taskSettings.approvalPolicy,
  approvalsReviewer: taskSettings.approvalsReviewer,
  fastMode: false,
  model: taskSettings.model,
  reasoningEffort: taskSettings.reasoningEffort,
  sandboxMode: taskSettings.sandboxMode,
};

export const globalSettings = {
  ...taskSettings,
  commitMessageModel: "gpt-5.6-sol",
  commitMessagePrompt: "",
  defaultOpenAppId: "visual-studio-code" as const,
  fastMode: false,
  followUpBehavior: "queue" as const,
};

export const modelPage = {
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
};

export const skill = {
  description: "审查认证、授权和敏感数据边界",
  displayName: "Security review",
  id: "skill_01J00000000000000000000000",
  name: "review-security",
  scope: "system" as const,
};

export const skillPage = {
  data: [skill],
  nextCursor: null,
};

export const mcpServerPage = {
  data: ["fast-context", "chrome-devtools"].map((name) => ({
    authStatus: "unsupported" as const,
    description: null,
    error: null,
    failureReason: null,
    name,
    status: "ready" as const,
    title: null,
    toolCount: 2,
    version: "1.0.0",
  })),
};

export const pixelBytes = Uint8Array.from(
  globalThis.atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (value) => value.charCodeAt(0),
);

export const attachment = {
  id: "attachment-1",
  kind: "image",
  mediaType: "image/png",
  name: "screen.png",
  size: 68,
};

export const projectRootPath = "/workspace/CodeAgent";

export const pendingRequest: PendingRequest = {
  availableDecisions: ["allow", "deny"],
  command: "pnpm check",
  createdAt: "2026-07-23T00:02:00.000Z",
  cwd: "/workspace/CodeAgent",
  expiresAt: null,
  itemId: "command-1",
  networkAccess: null,
  projectId: "code-agent",
  reason: null,
  requestId: "number:7",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
  type: "command_approval",
};

export function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

export function parseJsonRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") {
    throw new Error("Expected a JSON string request body");
  }
  return JSON.parse(body) as unknown;
}
