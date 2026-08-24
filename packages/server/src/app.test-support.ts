import type { AgentModelPage, PendingRequest } from "@code-agent/protocol";
import { Buffer } from "node:buffer";
import { afterEach } from "vitest";

// 集中维护 Server 测试的协议样本与资源回收钩子。
export const projectRootPath = "/workspace/CodeAgent";

export const encodedProjectRootPath = "%2Fworkspace%2FCodeAgent";

export const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  roots: [{ id: "root-code-agent", path: projectRootPath }],
} as const;

export const temporaryProject = {
  createdAt: "2026-08-06T00:00:00.000Z",
  id: "temporary",
  name: "Temporary",
  rootPath: "/code-agent/temporary-workspace",
  roots: [{ id: "root-temporary", path: "/code-agent/temporary-workspace" }],
} as const;

export const pixelDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export const pastedTextDataUrl = "data:text/plain;base64,5L2g5aW9IENvZGVBZ2VudA==";

export const historicalImageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export const turnOptions = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function multipartAttachment(
  kind: "file" | "image" | "text",
  name: string,
  mediaType: string,
  content: Uint8Array,
  idempotencyKey: string,
) {
  const form = new FormData();
  form.set("attachment", new File([content], name, { type: mediaType }));
  const request = new Request("http://code-agent.local", { body: form, method: "POST" });
  return {
    headers: {
      "content-type": request.headers.get("content-type") ?? "",
      "idempotency-key": idempotencyKey,
    },
    method: "POST" as const,
    payload: Buffer.from(await request.arrayBuffer()),
    url: `/v1/projects/code-agent/attachments/${kind}`,
  };
}

export const modelPage: AgentModelPage = {
  data: [
    {
      defaultReasoningEffort: "low",
      description: "适合快速任务",
      displayName: "GPT-5.6 Luna",
      id: "gpt-5.6-luna",
      isDefault: false,
      supportedReasoningEfforts: [{ description: "快速分析", id: "low" }],
    },
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

export function turnRequest(text: string) {
  return {
    input: { attachments: [], skills: [], text, type: "prompt" as const },
    options: turnOptions,
  };
}

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
  status: "idle" as const,
  turns: [],
  turnsNextCursor: null,
};

export const pendingRequest = {
  availableDecisions: ["allow", "allow_for_session", "deny"],
  command: "pnpm check",
  createdAt: "2026-07-23T00:02:00.000Z",
  cwd: "/workspace/CodeAgent",
  expiresAt: null,
  itemId: "command-1",
  networkAccess: null,
  projectId: "code-agent",
  reason: "需要执行检查",
  requestId: "number:7",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
  type: "command_approval",
} as const satisfies PendingRequest;

export const closeCallbacks: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});
