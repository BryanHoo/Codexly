import type { AgentItem } from "@codexly/protocol";

import {
  CodexProtocolMappingError,
  expectRecord,
  expectString,
  optionalInteger,
  optionalString,
} from "./codex-mapping-common.js";
import {
  mapUserMessageContent,
  type MapCodexMessageImage,
  type MapCodexMessageText,
} from "./codex-message-mapping.js";
import { mapCodexFileChange } from "./codex-diff-mapping.js";
import {
  mapApprovalReviewStatus,
  mapItemStatus,
  type AgentApprovalReviewItem,
} from "./codex-status-mapping.js";
import {
  boundCommandOutput,
  createActivityItem,
  mapCodexMessagePhase,
  mapCollaborationToolItem,
  mapReviewHint,
  mapSubagentActivityItem,
  mapToolItem,
} from "./codex-tool-mapping.js";

type ImageGenerationFailureOutput = Readonly<{
  reason: "usage_limit_exceeded";
  resetsAt: number | null;
}>;

function mapImageGenerationFailure(value: unknown): ImageGenerationFailureOutput | undefined {
  if (value === null) {
    return undefined;
  }
  const failure = expectRecord(value, "Codex image generation failure");
  if (failure["type"] !== "usageLimitExceeded") {
    throw new CodexProtocolMappingError("Codex image generation failure type is invalid");
  }
  const limitId = expectString(failure["limitId"], "Codex image generation failure limit id");
  if (limitId.length === 0) {
    throw new CodexProtocolMappingError("Codex image generation failure limit id is invalid");
  }
  const resetsAt = failure["resetsAt"];
  if (resetsAt !== null && (typeof resetsAt !== "number" || !Number.isFinite(resetsAt))) {
    throw new CodexProtocolMappingError("Codex image generation failure reset time is invalid");
  }
  // 原生限制 ID 不越过 Provider 边界，只保留通用原因和可展示的重置时间。
  return { reason: "usage_limit_exceeded", resetsAt };
}

function mapApprovalReviewAction(value: unknown): AgentApprovalReviewItem["action"] {
  const action = expectRecord(value, "Codex automatic approval review action");
  const type = expectString(action["type"], "Codex automatic approval review action type");
  if (type === "command") {
    return {
      detail: expectString(action["command"], "Codex automatic approval review command"),
      type: "command",
    };
  }
  if (type === "execve") {
    const argv = action["argv"];
    if (!Array.isArray(argv) || argv.some((part) => typeof part !== "string")) {
      throw new CodexProtocolMappingError("Codex automatic approval review argv is invalid");
    }
    const stringArgv = argv.map((part, index) =>
      expectString(part, `Codex automatic approval review argv ${String(index)}`),
    );
    return {
      detail: [
        expectString(action["program"], "Codex automatic approval review program"),
        ...stringArgv,
      ].join(" "),
      type: "command",
    };
  }
  if (type === "writeStdin") {
    return {
      detail: expectString(action["stdin"], "Codex automatic approval review terminal input"),
      type: "command",
    };
  }
  if (type === "applyPatch") {
    const files = action["files"];
    if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {
      throw new CodexProtocolMappingError("Codex automatic approval review files are invalid");
    }
    return { detail: files.join("\n"), type: "file_change" };
  }
  if (type === "networkAccess") {
    return {
      detail: expectString(action["target"], "Codex automatic approval review network target"),
      type: "network_access",
    };
  }
  if (type === "mcpToolCall") {
    const title = optionalString(action["toolTitle"]);
    return {
      detail:
        title ??
        `${expectString(action["server"], "Codex automatic approval review MCP server")}/${expectString(action["toolName"], "Codex automatic approval review MCP tool")}`,
      type: "mcp_tool_call",
    };
  }
  if (type === "requestPermissions") {
    const permissions = expectRecord(
      action["permissions"],
      "Codex automatic approval review permissions",
    );
    return {
      detail: optionalString(action["reason"]) ?? JSON.stringify(permissions),
      type: "permissions",
    };
  }
  throw new CodexProtocolMappingError("Codex automatic approval review action type is invalid");
}

function validateAsyncUserInputQuestions(value: unknown): void {
  if (value === null) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new CodexProtocolMappingError("Codex agent message questions must be an array or null");
  }
  for (const questionValue of value) {
    const question = expectRecord(questionValue, "Codex asynchronous user input question");
    expectString(question["title"], "Codex asynchronous user input question title");
    const options = question["options"];
    if (options !== null && !Array.isArray(options)) {
      throw new CodexProtocolMappingError(
        "Codex asynchronous user input question options must be an array or null",
      );
    }
    if (Array.isArray(options)) {
      for (const option of options) {
        if (typeof option !== "string") {
          throw new CodexProtocolMappingError(
            "Codex asynchronous user input question options must contain only strings",
          );
        }
      }
    }
  }
}

export function mapApprovalReviewItem(params: Record<string, unknown>): AgentApprovalReviewItem {
  const review = expectRecord(params["review"], "Codex automatic approval review");
  const riskLevel = optionalString(review["riskLevel"]);
  const userAuthorization = optionalString(review["userAuthorization"]);
  if (
    riskLevel !== undefined &&
    riskLevel !== "low" &&
    riskLevel !== "medium" &&
    riskLevel !== "high" &&
    riskLevel !== "critical"
  ) {
    throw new CodexProtocolMappingError("Codex automatic approval review risk level is invalid");
  }
  if (
    userAuthorization !== undefined &&
    userAuthorization !== "unknown" &&
    userAuthorization !== "low" &&
    userAuthorization !== "medium" &&
    userAuthorization !== "high"
  ) {
    throw new CodexProtocolMappingError(
      "Codex automatic approval review user authorization is invalid",
    );
  }
  const targetItemId = optionalString(params["targetItemId"]);
  const rationale = optionalString(review["rationale"]);
  return {
    action: mapApprovalReviewAction(params["action"]),
    id: `auto-approval-review-${expectString(params["reviewId"], "Codex automatic approval review id")}`,
    ...(rationale === undefined ? {} : { rationale }),
    ...(riskLevel === undefined ? {} : { riskLevel }),
    status: mapApprovalReviewStatus(review["status"]),
    ...(targetItemId === undefined ? {} : { targetItemId }),
    type: "approval_review",
    ...(userAuthorization === undefined ? {} : { userAuthorization }),
  };
}

export function mapAgentItem(
  value: unknown,
  subagentNicknames: ReadonlyMap<string, string> = new Map(),
  mapImage: MapCodexMessageImage = () => undefined,
  mapText: MapCodexMessageText = () => undefined,
): AgentItem {
  const item = expectRecord(value, "Codex item");
  const id = expectString(item["id"], "Codex item id");
  const type = expectString(item["type"], "Codex item type");

  switch (type) {
    case "userMessage": {
      const content = mapUserMessageContent(item["content"], mapImage, mapText);
      return {
        ...(content.attachments.length === 0 ? {} : { attachments: content.attachments }),
        id,
        role: "user",
        ...(content.skills.length === 0 ? {} : { skills: content.skills }),
        text: content.text,
        type: "message",
      };
    }
    case "agentMessage": {
      const text = expectString(item["text"], "Codex agent message text");
      // 上游已把异步问题渲染进正文；只校验元数据，避免热路径重复分配展示结构。
      validateAsyncUserInputQuestions(item["questions"]);
      if (item["delivery"] !== null && item["delivery"] !== "async") {
        throw new CodexProtocolMappingError("Codex agent message delivery must be async or null");
      }
      // 保留官方消息阶段，供客户端区分可折叠过程和最终回复。
      const phase = mapCodexMessagePhase(item["phase"]);
      return {
        id,
        ...(phase === undefined ? {} : { phase }),
        role: "assistant",
        text,
        type: "message",
      };
    }
    case "reasoning":
      return {
        content: Array.isArray(item["content"])
          ? item["content"].filter((entry): entry is string => typeof entry === "string").join("\n")
          : "",
        id,
        summary: Array.isArray(item["summary"])
          ? item["summary"].filter((entry): entry is string => typeof entry === "string").join("\n")
          : "",
        type: "reasoning",
      };
    case "commandExecution": {
      const exitCode = optionalInteger(item["exitCode"]);
      const nativeOutput = optionalString(item["aggregatedOutput"]);
      const output = nativeOutput === undefined ? undefined : boundCommandOutput(nativeOutput);
      return {
        command: expectString(item["command"], "Codex command"),
        cwd: expectString(item["cwd"], "Codex command cwd"),
        ...(exitCode === undefined ? {} : { exitCode }),
        id,
        ...(output === undefined ? {} : { output: output.output }),
        outputOmitted: output?.outputOmitted ?? { bytes: 0, lines: 0 },
        status: mapItemStatus(item["status"]),
        type: "command",
      };
    }
    case "fileChange": {
      if (!Array.isArray(item["changes"])) {
        throw new CodexProtocolMappingError("Codex file changes must be an array");
      }
      return {
        changes: item["changes"].map(mapCodexFileChange),
        id,
        status: mapItemStatus(item["status"]),
        type: "file_change",
      };
    }
    case "mcpToolCall":
      return mapToolItem(
        item,
        id,
        `${expectString(item["server"], "Codex MCP server")}/${expectString(item["tool"], "Codex MCP tool")}`,
      );
    case "dynamicToolCall": {
      const namespace = optionalString(item["namespace"]);
      const tool = expectString(item["tool"], "Codex dynamic tool");
      return mapToolItem(item, id, namespace ? `${namespace}/${tool}` : tool);
    }
    case "functionCallOutput": {
      const name = expectString(item["name"], "Codex function call output name");
      const namespace = optionalString(item["namespace"]);
      return {
        id,
        name: namespace ? `${namespace}/${name}` : name,
        output: item["output"],
        status: "completed",
        type: "tool",
      };
    }
    case "collabAgentToolCall":
      return mapCollaborationToolItem(item, id, subagentNicknames);
    case "webSearch":
      return {
        id,
        input: { query: expectString(item["query"], "Codex web search query") },
        name: "web_search",
        ...(item["results"] === undefined || item["results"] === null
          ? {}
          : { output: item["results"] }),
        status: "completed",
        type: "tool",
      };
    case "imageGeneration": {
      const status = mapItemStatus(item["status"]);
      const failure = mapImageGenerationFailure(item["failure"]);
      const attachment = status === "completed" ? mapImage(item, 0) : undefined;
      if (attachment !== undefined) {
        // 图片正文留在受控附件存储，Timeline 和事件只传递固定大小的授权元数据。
        return {
          attachments: [attachment],
          id,
          role: "assistant",
          text: "",
          type: "message",
        };
      }
      return {
        id,
        name: "image_generation",
        ...(failure === undefined ? {} : { output: failure }),
        status,
        type: "tool",
      };
    }
    case "plan":
      return { id, text: expectString(item["text"], "Codex plan text"), type: "plan" };
    case "hookPrompt":
      return createActivityItem(id, "Hook 提示");
    case "subAgentActivity":
      return mapSubagentActivityItem(item, id);
    case "imageView":
      return createActivityItem(id, "查看图片", optionalString(item["path"]));
    case "sleep":
      return {
        detail: `${String(optionalInteger(item["durationMs"]) ?? 0)}ms`,
        id,
        label: "等待",
        type: "activity",
      };
    case "enteredReviewMode":
      return {
        id,
        target: mapReviewHint(expectString(item["review"], "Codex review mode hint")),
        type: "review",
      };
    case "exitedReviewMode":
      // Codex 将最终审查结论放在 exitedReviewMode.review，而不是 agentMessage。
      return {
        id,
        role: "assistant",
        text: expectString(item["review"], "Codex review result"),
        type: "message",
      };
    case "contextCompaction":
      // 上下文压缩只描述当前运行阶段，完成后不应作为历史结果保留。
      return { ...createActivityItem(id, "上下文压缩"), transient: true };
    default:
      // 未知原生对象不向上透传，只保留定位协议漂移所需的类型名称。
      return {
        detail: `未识别的活动类型: ${type}`,
        id,
        label: "Provider 活动",
        type: "activity",
      };
  }
}
