import { Buffer } from "node:buffer";
import type { AgentItem, AgentItemStatus, AgentReviewTarget } from "@codexly/protocol";

import {
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_COMMAND_OUTPUT_LINES,
  CodexProtocolMappingError,
  expectRecord,
  expectString,
  isRecord,
  optionalString,
} from "./codex-mapping-common.js";
import { mapItemStatus } from "./codex-status-mapping.js";

export function mapFileChangeKind(value: unknown): "create" | "delete" | "update" {
  const type = optionalString(isRecord(value) ? value["type"] : undefined);
  if (type === "add") {
    return "create";
  }
  if (type === "delete" || type === "update") {
    return type;
  }
  throw new CodexProtocolMappingError("Codex file change kind is invalid");
}

function sliceUtf8Tail(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, "utf8");
  let start = Math.max(0, encoded.length - maxBytes);

  // 跳过 UTF-8 续字节，确保截断后的首字符保持完整。
  while (start < encoded.length) {
    const byte = encoded[start];
    if (byte === undefined || (byte & 0xc0) !== 0x80) {
      break;
    }
    start += 1;
  }

  return encoded.subarray(start).toString("utf8");
}

export function boundCommandOutput(value: string): { output: string; outputTruncated: boolean } {
  let output = value;
  let outputTruncated = false;
  let newlineCount = 0;

  // 从尾部保留最新日志；超过行数时无需创建完整行数组。
  for (let index = output.length - 1; index >= 0; index -= 1) {
    if (output.charCodeAt(index) !== 10) {
      continue;
    }
    newlineCount += 1;
    if (newlineCount === MAX_COMMAND_OUTPUT_LINES) {
      output = output.slice(index + 1);
      outputTruncated = true;
      break;
    }
  }

  if (Buffer.byteLength(output, "utf8") > MAX_COMMAND_OUTPUT_BYTES) {
    output = sliceUtf8Tail(output, MAX_COMMAND_OUTPUT_BYTES);
    outputTruncated = true;
  }

  return { output, outputTruncated };
}

export function mapToolError(value: unknown): { error: string } | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const error = expectRecord(value, "Codex tool error");
  return { error: expectString(error["message"], "Codex tool error message") };
}

export function mapToolItem(item: Record<string, unknown>, id: string, name: string): AgentItem {
  const input = item["arguments"];
  const output = item["result"] ?? item["contentItems"] ?? mapToolError(item["error"]);
  return {
    id,
    ...(input === undefined ? {} : { input }),
    name,
    ...(output === undefined ? {} : { output }),
    status: mapItemStatus(item["status"]),
    type: "tool",
  };
}

export function createActivityItem(
  id: string,
  label: string,
  detail?: string,
): Extract<AgentItem, { type: "activity" }> {
  return detail === undefined
    ? { id, label, type: "activity" }
    : { detail, id, label, type: "activity" };
}

export function markStartedItemRunning(item: AgentItem): AgentItem {
  // 启动通知代表当前操作，统一覆盖原生缺省状态供 Web 实时展示。
  if (
    item.type === "command" ||
    item.type === "file_change" ||
    item.type === "tool" ||
    item.type === "activity"
  ) {
    return { ...item, status: "running" };
  }
  return item;
}

const collaborationToolNames = {
  closeAgent: "agent/close",
  resumeAgent: "agent/resume",
  sendInput: "agent/send_input",
  spawnAgent: "agent/spawn",
  wait: "agent/wait",
} as const;

export function mapCollaborationAgentStatus(value: unknown): AgentItemStatus {
  if (value === "pendingInit") {
    return "pending";
  }
  if (value === "errored" || value === "notFound") {
    return "failed";
  }
  if (value === "shutdown") {
    return "completed";
  }
  return mapItemStatus(value);
}

export function mapCollaborationToolItem(
  item: Record<string, unknown>,
  id: string,
  subagentNicknames: ReadonlyMap<string, string>,
): AgentItem {
  const nativeToolName = expectString(item["tool"], "Codex collaboration tool");
  if (!(nativeToolName in collaborationToolNames)) {
    throw new CodexProtocolMappingError("Codex collaboration tool is invalid");
  }
  const toolName = collaborationToolNames[nativeToolName as keyof typeof collaborationToolNames];
  if (!Array.isArray(item["receiverThreadIds"])) {
    throw new CodexProtocolMappingError("Codex collaboration receivers must be an array");
  }
  const receiverTaskIds = item["receiverThreadIds"].map((value) =>
    expectString(value, "Codex collaboration receiver thread id"),
  );
  const prompt = optionalString(item["prompt"]);
  const model = optionalString(item["model"]);
  const reasoningEffort = optionalString(item["reasoningEffort"]);
  const agentsStates = expectRecord(item["agentsStates"], "Codex collaboration agent states");
  const agents = Object.entries(agentsStates).map(([taskId, value]) => {
    const agentState = expectRecord(value, "Codex collaboration agent state");
    const message = optionalString(agentState["message"]);
    const nickname = subagentNicknames.get(taskId);
    return {
      ...(message === undefined ? {} : { message }),
      ...(nickname === undefined ? {} : { nickname }),
      status: mapCollaborationAgentStatus(agentState["status"]),
      taskId,
    };
  });

  return {
    id,
    input: {
      ...(model === undefined ? {} : { model }),
      ...(prompt === undefined ? {} : { prompt }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      receiverTaskIds,
      senderTaskId: expectString(item["senderThreadId"], "Codex collaboration sender thread id"),
    },
    name: toolName,
    output: { agents },
    status: mapItemStatus(item["status"]),
    type: "tool",
  };
}

export function mapSubagentActivityItem(item: Record<string, unknown>, id: string): AgentItem {
  expectString(item["agentThreadId"], "Codex subagent thread id");
  const agentPath = expectString(item["agentPath"], "Codex subagent path");
  const agentName = agentPath.split("/").filter(Boolean).at(-1) ?? agentPath;
  const kind = expectString(item["kind"], "Codex subagent activity kind");
  const activityLabels: Readonly<Record<string, string>> = {
    interacted: "已交互",
    interrupted: "已中断",
    started: "已启动",
  };
  const detail = activityLabels[kind];
  if (detail === undefined) {
    throw new CodexProtocolMappingError("Codex subagent activity kind is invalid");
  }
  return {
    detail,
    id,
    label: `子代理 ${agentName}`,
    status: kind === "interrupted" ? "interrupted" : "completed",
    type: "activity",
  };
}

type CodexMessagePhase = "commentary" | "final_answer";

const CODEX_UNCOMMITTED_REVIEW_PROMPT =
  "Review the current code changes (staged, unstaged, and untracked files)";

export function mapReviewHint(review: string): AgentReviewTarget {
  if (review === "current changes") {
    return { type: "uncommitted_changes" };
  }
  const baseBranch = /^changes against '(.+)'$/.exec(review)?.[1];
  if (baseBranch !== undefined) {
    return { branch: baseBranch, type: "base_branch" };
  }
  const commit = /^commit (\S+)(?:: (.+))?$/.exec(review);
  if (commit?.[1] !== undefined) {
    return {
      sha: commit[1],
      ...(commit[2] === undefined ? {} : { title: commit[2] }),
      type: "commit",
    };
  }
  return { instructions: review, type: "custom" };
}

export function readNativeUserMessageText(item: Record<string, unknown>): string | undefined {
  if (item["type"] !== "userMessage" || !Array.isArray(item["content"])) {
    return undefined;
  }
  return item["content"]
    .flatMap((part) => {
      const contentPart = expectRecord(part, "Codex user message content part");
      return contentPart["type"] === "text" && typeof contentPart["text"] === "string"
        ? [contentPart["text"]]
        : [];
    })
    .join("\n");
}

export function inferReviewTargetFromPrompt(
  item: Record<string, unknown>,
): AgentReviewTarget | undefined {
  const text = readNativeUserMessageText(item);
  if (text === undefined) {
    return undefined;
  }
  if (text.startsWith(CODEX_UNCOMMITTED_REVIEW_PROMPT)) {
    return { type: "uncommitted_changes" };
  }
  const baseBranch = /^Review the code changes against the base branch '([^']+)'\./.exec(text)?.[1];
  if (baseBranch !== undefined) {
    return { branch: baseBranch, type: "base_branch" };
  }
  const commit = /^Review the code changes introduced by commit (\S+?)(?: \("([\s\S]+)"\))?\./.exec(
    text,
  );
  if (commit?.[1] !== undefined) {
    return {
      sha: commit[1],
      ...(commit[2] === undefined ? {} : { title: commit[2] }),
      type: "commit",
    };
  }
  return undefined;
}

export function createReviewItem(turnId: string, target: AgentReviewTarget): AgentItem {
  return { id: `review-mode-${turnId}`, target, type: "review" };
}

export function mapCodexMessagePhase(value: unknown): CodexMessagePhase | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value === "commentary" || value === "final_answer") {
    return value;
  }
  throw new CodexProtocolMappingError("Codex agent message phase is invalid");
}
