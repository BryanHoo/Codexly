import type { AgentProviderTaskSnapshot } from "@code-agent/core";
import type {
  AgentContextUsage,
  AgentModelPage,
  AgentReviewTarget,
  AgentTurn,
} from "@code-agent/protocol";

import {
  CodexProtocolMappingError,
  expectRecord,
  expectString,
  isRecord,
  optionalInteger,
  optionalString,
  toNullableDateTime,
} from "./codex-mapping-common.js";
import { mapAgentItem } from "./codex-item-mapping.js";
import {
  mergeExpandedSkillMessages,
  type MapCodexMessageImage,
  type MapCodexMessageText,
} from "./codex-message-mapping.js";
import {
  createReviewItem,
  inferReviewTargetFromPrompt,
  mapReviewHint,
} from "./codex-tool-mapping.js";

export function normalizedTitle(thread: Record<string, unknown>): string {
  const name = optionalString(thread["name"])?.trim();
  if (name) {
    return name;
  }
  const preview = optionalString(thread["preview"])?.trim().split(/\r?\n/u)[0]?.trim();
  // Codex 生成正式标题前统一显示新聊天，后续列表刷新会自然替换为 name 或 preview。
  return preview?.length ? preview : "新聊天";
}

export function mapAgentModel(value: unknown): AgentModelPage["data"][number] | undefined {
  const model = expectRecord(value, "Codex model");
  const multiAgentVersion = model["multiAgentVersion"];
  if (
    multiAgentVersion !== null &&
    multiAgentVersion !== "disabled" &&
    multiAgentVersion !== "v1" &&
    multiAgentVersion !== "v2"
  ) {
    throw new CodexProtocolMappingError("Codex model multi-agent version is invalid");
  }
  if (model["hidden"] === true) {
    return undefined;
  }
  if (model["hidden"] !== false || typeof model["isDefault"] !== "boolean") {
    throw new CodexProtocolMappingError("Codex model visibility or default flag is invalid");
  }
  if (!Array.isArray(model["supportedReasoningEfforts"])) {
    throw new CodexProtocolMappingError("Codex model reasoning efforts must be an array");
  }
  const supportedReasoningEfforts = model["supportedReasoningEfforts"].map((value) => {
    const option = expectRecord(value, "Codex model reasoning effort");
    return {
      description: expectString(option["description"], "Codex reasoning effort description"),
      id: expectString(option["reasoningEffort"], "Codex reasoning effort id"),
    };
  });
  const defaultReasoningEffort = expectString(
    model["defaultReasoningEffort"],
    "Codex model default reasoning effort",
  );
  if (
    supportedReasoningEfforts.length === 0 ||
    !supportedReasoningEfforts.some((option) => option.id === defaultReasoningEffort)
  ) {
    throw new CodexProtocolMappingError("Codex model default reasoning effort is unsupported");
  }
  return {
    defaultReasoningEffort,
    description: expectString(model["description"], "Codex model description"),
    displayName: expectString(model["displayName"], "Codex model displayName"),
    id: expectString(model["model"], "Codex model model"),
    isDefault: model["isDefault"],
    supportedReasoningEfforts,
  };
}

export function mapContextUsage(value: unknown): AgentContextUsage {
  const tokenUsage = expectRecord(value, "Codex token usage");
  const last = expectRecord(tokenUsage["last"], "Codex last token usage");
  const usedTokens = optionalInteger(last["totalTokens"]);
  const rawContextWindow = tokenUsage["modelContextWindow"];
  const parsedContextWindow = rawContextWindow === null ? null : optionalInteger(rawContextWindow);
  if (usedTokens === undefined || usedTokens < 0) {
    throw new CodexProtocolMappingError("Codex context usage is invalid");
  }
  if (
    parsedContextWindow !== null &&
    (parsedContextWindow === undefined || parsedContextWindow <= 0)
  ) {
    throw new CodexProtocolMappingError("Codex context usage is invalid");
  }
  return { contextWindow: parsedContextWindow, usedTokens };
}

export function mapThreadStatus(value: unknown): AgentProviderTaskSnapshot["status"] {
  const type = optionalString(isRecord(value) ? value["type"] : undefined);
  if (type === "active") {
    return "running";
  }
  if (type === "systemError") {
    return "failed";
  }
  return "idle";
}

export function mapTurnStatus(value: unknown): AgentTurn["status"] {
  if (value === "inProgress") {
    return "running";
  }
  if (value === "completed" || value === "failed" || value === "interrupted") {
    return value;
  }
  throw new CodexProtocolMappingError("Codex turn status is invalid");
}

export function mapAgentTurn(
  value: unknown,
  mapImage: MapCodexMessageImage = () => undefined,
  mapText: MapCodexMessageText = () => undefined,
  explicitReviewTarget?: AgentReviewTarget,
  explicitTurnId?: string,
  reviewWorker = false,
  suppressReviewResult = false,
): AgentTurn {
  const turn = expectRecord(value, "Codex turn");
  if (!Array.isArray(turn["items"])) {
    throw new CodexProtocolMappingError("Codex turn items must be an array");
  }
  const turnId = explicitTurnId ?? expectString(turn["id"], "Codex turn id");
  const nativeItems = turn["items"].map((item) => expectRecord(item, "Codex turn item"));
  const enteredReviewMode = nativeItems.find((item) => item["type"] === "enteredReviewMode");
  const exitedReviewMode = nativeItems.findLast(
    (item) =>
      item["type"] === "exitedReviewMode" &&
      typeof item["review"] === "string" &&
      item["review"].trim().length > 0,
  );
  const interruptedReviewMessage = nativeItems.findLast(
    (item) =>
      item["type"] === "agentMessage" &&
      item["phase"] !== "commentary" &&
      typeof item["text"] === "string" &&
      item["text"].trim().length > 0,
  );
  const inferredReviewTarget = nativeItems
    .map(inferReviewTargetFromPrompt)
    .find((target) => target !== undefined);
  const reviewTarget =
    explicitReviewTarget ??
    (enteredReviewMode === undefined
      ? inferredReviewTarget
      : mapReviewHint(expectString(enteredReviewMode["review"], "Codex review mode hint")));
  const isReviewTurn =
    explicitReviewTarget !== undefined ||
    enteredReviewMode !== undefined ||
    nativeItems.some((item) => item["type"] === "exitedReviewMode");
  const reviewResultItem = exitedReviewMode ?? interruptedReviewMessage;
  const subagentNicknames = new Map<string, string>();
  for (const item of nativeItems) {
    if (item["type"] !== "subAgentActivity") {
      continue;
    }
    const taskId = expectString(item["agentThreadId"], "Codex subagent thread id");
    const agentPath = expectString(item["agentPath"], "Codex subagent path");
    const nickname = agentPath.split("/").filter(Boolean).at(-1) ?? agentPath;
    subagentNicknames.set(taskId, nickname);
  }
  return {
    completedAt: toNullableDateTime(turn["completedAt"], "Codex turn completedAt"),
    error:
      turn["error"] === null || turn["error"] === undefined
        ? null
        : expectString(
            expectRecord(turn["error"], "Codex turn error")["message"],
            "Codex turn error message",
          ),
    id: turnId,
    // 先收集活动项中的昵称，再回填协作项，避免向 Web 暴露不可读的线程 ID。
    items: reviewWorker
      ? mergeExpandedSkillMessages([
          ...(reviewTarget === undefined ? [] : [createReviewItem(turnId, reviewTarget)]),
          ...nativeItems.flatMap((item) =>
            item["type"] === "userMessage" ||
            item["type"] === "enteredReviewMode" ||
            item["type"] === "exitedReviewMode"
              ? []
              : [mapAgentItem(item, subagentNicknames, mapImage, mapText)],
          ),
        ])
      : isReviewTurn
        ? [
            ...(reviewTarget === undefined ? [] : [createReviewItem(turnId, reviewTarget)]),
            ...(reviewResultItem === undefined || suppressReviewResult
              ? []
              : [mapAgentItem(reviewResultItem, subagentNicknames, mapImage, mapText)]),
          ]
        : mergeExpandedSkillMessages(
            nativeItems.map((item) => mapAgentItem(item, subagentNicknames, mapImage, mapText)),
          ),
    startedAt: toNullableDateTime(turn["startedAt"], "Codex turn startedAt"),
    status: mapTurnStatus(turn["status"]),
  };
}

export function mapAgentTurns(
  values: readonly unknown[],
  mapImage: MapCodexMessageImage = () => undefined,
  mapText: MapCodexMessageText = () => undefined,
): AgentTurn[] {
  const turns: AgentTurn[] = [];
  for (let turnIndex = 0; turnIndex < values.length; turnIndex += 1) {
    const nativeTurn = expectRecord(values[turnIndex], "Codex turn");
    const mappedTurn = mapAgentTurn(nativeTurn, mapImage, mapText);
    const nativeItems = Array.isArray(nativeTurn["items"])
      ? nativeTurn["items"].map((item) => expectRecord(item, "Codex turn item"))
      : [];
    const isReviewContainer = nativeItems.some(
      (item) => item["type"] === "enteredReviewMode" || item["type"] === "exitedReviewMode",
    );
    const nextNativeTurn = values[turnIndex + 1];
    if (!isReviewContainer || nextNativeTurn === undefined) {
      turns.push(mappedTurn);
      continue;
    }

    const workerTurn = expectRecord(nextNativeTurn, "Codex reviewer turn");
    const workerItems = Array.isArray(workerTurn["items"])
      ? workerTurn["items"].map((item) => expectRecord(item, "Codex reviewer item"))
      : [];
    const isReviewerWorker = workerItems.some(
      (item) => item["type"] === "userMessage" && inferReviewTargetFromPrompt(item) !== undefined,
    );
    if (!isReviewerWorker) {
      turns.push(mappedTurn);
      continue;
    }

    const mappedWorker = mapAgentTurn(workerTurn, mapImage, mapText);
    const visibleWorkerItems = mappedWorker.items.filter(
      (item) => item.type !== "message" || item.role !== "user",
    );
    const hasWorkerResponse = visibleWorkerItems.some(
      (item) => item.type === "message" && item.role === "assistant",
    );
    const hasOuterReviewExit = nativeItems.some((item) => item["type"] === "exitedReviewMode");
    const reviewRequestItems = mappedTurn.items.filter((item) => item.type === "review");
    const outerFallbackItems = hasWorkerResponse
      ? []
      : mappedTurn.items.filter((item) => item.type === "message" && item.role === "assistant");
    turns.push({
      completedAt: hasOuterReviewExit ? (mappedTurn.completedAt ?? mappedWorker.completedAt) : null,
      error: mappedWorker.error ?? mappedTurn.error,
      id: mappedTurn.id,
      items: [...reviewRequestItems, ...visibleWorkerItems, ...outerFallbackItems],
      startedAt: mappedWorker.startedAt ?? mappedTurn.startedAt,
      status: hasOuterReviewExit ? mappedWorker.status : "running",
    });
    turnIndex += 1;
  }
  return turns;
}

export function attachTranscriptSkills(turn: AgentTurn, skillNames: readonly string[]): AgentTurn {
  if (skillNames.length === 0) {
    return turn;
  }

  const userMessageIndex = turn.items.findIndex(
    (item) => item.type === "message" && item.role === "user",
  );
  const userMessage = turn.items[userMessageIndex];
  if (userMessageIndex < 0 || userMessage?.type !== "message" || userMessage.role !== "user") {
    return turn;
  }

  const existingSkillNames = new Set((userMessage.skills ?? []).map((skill) => skill.name));
  const skills = [...(userMessage.skills ?? [])];
  for (const name of skillNames) {
    if (!existingSkillNames.has(name)) {
      existingSkillNames.add(name);
      skills.push({ name });
    }
  }
  const items = turn.items.map((item, itemIndex) =>
    itemIndex === userMessageIndex ? { ...userMessage, skills } : item,
  );
  return { ...turn, items };
}
