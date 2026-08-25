import type { AgentGoal, AgentGoalStatus } from "@codexly/protocol";

import {
  CodexProtocolMappingError,
  expectRecord,
  expectString,
  optionalInteger,
  toDateTime,
} from "./codex-mapping-common.js";

function mapGoalStatus(value: unknown): AgentGoalStatus {
  const statuses: Readonly<Record<string, AgentGoalStatus>> = {
    active: "active",
    blocked: "blocked",
    budgetLimited: "budget_limited",
    complete: "complete",
    paused: "paused",
    usageLimited: "usage_limited",
  };
  if (typeof value !== "string" || statuses[value] === undefined) {
    throw new CodexProtocolMappingError("Codex goal status is invalid");
  }
  return statuses[value];
}

function expectNonNegativeInteger(value: unknown, context: string): number {
  const integer = optionalInteger(value);
  if (integer === undefined || integer < 0) {
    throw new CodexProtocolMappingError(`${context} must be a non-negative integer`);
  }
  return integer;
}

export function mapCodexGoal(value: unknown, expectedTaskId?: string): AgentGoal {
  const goal = expectRecord(value, "Codex goal");
  const threadId = expectString(goal["threadId"], "Codex goal thread id");
  if (expectedTaskId !== undefined && threadId !== expectedTaskId) {
    throw new CodexProtocolMappingError("Codex goal belongs to a different thread");
  }
  const objective = expectString(goal["objective"], "Codex goal objective");
  if (objective.length === 0 || objective.length > 4_000) {
    throw new CodexProtocolMappingError("Codex goal objective is invalid");
  }
  const rawTokenBudget = goal["tokenBudget"];
  const tokenBudget =
    rawTokenBudget === null
      ? null
      : expectNonNegativeInteger(rawTokenBudget, "Codex goal token budget");
  return {
    createdAt: toDateTime(goal["createdAt"], "Codex goal createdAt"),
    objective,
    status: mapGoalStatus(goal["status"]),
    timeUsedSeconds: expectNonNegativeInteger(
      goal["timeUsedSeconds"],
      "Codex goal time used seconds",
    ),
    tokenBudget,
    tokensUsed: expectNonNegativeInteger(goal["tokensUsed"], "Codex goal tokens used"),
    updatedAt: toDateTime(goal["updatedAt"], "Codex goal updatedAt"),
  };
}
