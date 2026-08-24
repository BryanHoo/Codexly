import { createHash } from "node:crypto";
import type {
  AgentBackgroundTerminal,
  AgentSandboxMode,
  AgentSkillPage,
  PendingRequest,
} from "@code-agent/protocol";
import type { RpcRequestId } from "./jsonl-rpc-client.js";

export class CodexProtocolMappingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CodexProtocolMappingError";
  }
}

export const MAX_COMMAND_OUTPUT_BYTES = 1_048_576;
export const MAX_COMMAND_OUTPUT_LINES = 10_000;
export const CODEX_MAPPED_NOTIFICATION_METHODS: ReadonlySet<string> = new Set([
  "error",
  "guardianWarning",
  "hook/completed",
  "hook/started",
  "item/agentMessage/delta",
  "item/autoApprovalReview/completed",
  "item/autoApprovalReview/started",
  "autoApprovalReview/strictReviewRequired",
  "item/commandExecution/outputDelta",
  "item/completed",
  "item/fileChange/patchUpdated",
  "item/mcpToolCall/progress",
  "item/plan/delta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/started",
  "model/rerouted",
  "model/safetyBuffering/updated",
  "model/verification",
  "thread/tokenUsage/updated",
  "turn/completed",
  "turn/plan/updated",
  "turn/started",
  "warning",
]);

export const CODEX_SPECIAL_NOTIFICATION_METHODS: ReadonlySet<string> = new Set([
  "account/login/completed",
  "account/updated",
  "fuzzyFileSearch/sessionCompleted",
  "fuzzyFileSearch/sessionUpdated",
  "fs/changed",
  "mcpServer/startupStatus/updated",
  "serverRequest/resolved",
  "skills/changed",
  "thread/archived",
  "thread/deleted",
  "thread/name/updated",
  "thread/started",
  "thread/status/changed",
  "thread/queue/changed",
]);

export const CODEX_IGNORED_NOTIFICATION_METHODS: ReadonlySet<string> = new Set([
  "account/rateLimits/updated",
  "app/list/updated",
  "command/exec/outputDelta",
  "configWarning",
  "deprecationNotice",
  "externalAgentConfig/import/completed",
  "externalAgentConfig/import/progress",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "mcpServer/oauthLogin/completed",
  "process/exited",
  "process/outputDelta",
  "rawResponse/completed",
  "rawResponseItem/completed",
  "remoteControl/status/changed",
  "project/changed",
  "thread/closed",
  "thread/compacted",
  "thread/environment/connected",
  "thread/environment/disconnected",
  "thread/goal/cleared",
  "thread/goal/updated",
  "thread/project/updated",
  "thread/realtime/closed",
  "thread/realtime/error",
  "thread/realtime/itemAdded",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/started",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "thread/reverted",
  "thread/settings/updated",
  "thread/unarchived",
  "turn/diff/updated",
  "turn/moderationMetadata",
  "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted",
]);

// 在 initialize 阶段阻止 App Server 发送产品不消费的通知，避免无效 JSONL 解析和路由。
export const CODEX_OPT_OUT_NOTIFICATION_METHODS: readonly string[] = [
  ...CODEX_IGNORED_NOTIFICATION_METHODS,
].sort();

// 每个官方 Notification 必须明确映射、专门消费或主动忽略，禁止静默遗漏。
export const CODEX_NOTIFICATION_METHODS: ReadonlySet<string> = new Set([
  ...CODEX_MAPPED_NOTIFICATION_METHODS,
  ...CODEX_SPECIAL_NOTIFICATION_METHODS,
  ...CODEX_IGNORED_NOTIFICATION_METHODS,
]);

export interface PendingCodexRequest {
  denyDecision?: "cancel" | "decline";
  nativePermissionProfile?: Readonly<{
    fileSystem: Record<string, unknown> | null;
    network: Readonly<{ enabled: boolean | null }> | null;
  }>;
  providerRequestId: RpcRequestId;
  request: PendingRequest & { status: "pending" };
}
type PendingUserInputQuestion = Extract<
  PendingRequest,
  { type: "user_input" }
>["questions"][number];

type CodexSandboxPolicy =
  | Readonly<{ type: "dangerFullAccess" }>
  | Readonly<{ networkAccess: boolean; type: "readOnly" }>
  | Readonly<{
      excludeSlashTmp: boolean;
      excludeTmpdirEnvVar: boolean;
      networkAccess: boolean;
      type: "workspaceWrite";
      writableRoots: readonly string[];
    }>;

export type CodexSkill = Readonly<{
  description: string;
  displayName: string;
  enabled: boolean;
  id: string;
  name: string;
  path: string;
  scope: AgentSkillPage["data"][number]["scope"];
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CodexProtocolMappingError(`${context} must be an object`);
  }
  return value;
}

export function mapSandboxMode(value: unknown): AgentSandboxMode {
  if (value === null) {
    // Codex 未配置时采用其交互式编码安全默认值。
    return "workspace-write";
  }
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  throw new CodexProtocolMappingError("config/read sandbox_mode is invalid");
}

export function mapSandboxPolicy(mode: AgentSandboxMode): CodexSandboxPolicy {
  if (mode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }
  if (mode === "read-only") {
    return { networkAccess: false, type: "readOnly" };
  }
  return {
    excludeSlashTmp: false,
    excludeTmpdirEnvVar: false,
    networkAccess: false,
    type: "workspaceWrite",
    writableRoots: [],
  };
}

export function expectString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new CodexProtocolMappingError(`${context} must be a string`);
  }
  return value;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function mapBackgroundTerminal(value: unknown): AgentBackgroundTerminal {
  const terminal = expectRecord(value, "background terminal");
  return {
    command: expectString(terminal["command"], "background terminal command"),
    cwd: expectString(terminal["cwd"], "background terminal cwd"),
    // Codex processId 只在 Provider 边界出现，统一协议将其视为不透明终端标识。
    id: expectString(terminal["processId"], "background terminal process id"),
    itemId: expectString(terminal["itemId"], "background terminal item id"),
  };
}

export function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new CodexProtocolMappingError(`${context} must be a boolean`);
  }
  return value;
}

function createSkillId(name: string, path: string): string {
  // 浏览器只持有稳定摘要，Codex 绝对路径始终留在 Provider 边界内。
  const digest = createHash("sha256").update(`${name}\0${path}`).digest("hex");
  return `skill_${digest.slice(0, 32)}`;
}

export function mapCodexSkill(value: unknown): CodexSkill {
  const skill = expectRecord(value, "skills/list skill");
  const name = expectString(skill["name"], "skills/list skill name");
  const path = expectString(skill["path"], "skills/list skill path");
  const scope = skill["scope"];
  if (scope !== "user" && scope !== "repo" && scope !== "system" && scope !== "admin") {
    throw new CodexProtocolMappingError("skills/list skill scope is invalid");
  }
  const skillInterface = skill["interface"];
  const interfaceRecord =
    skillInterface === null || skillInterface === undefined
      ? undefined
      : expectRecord(skillInterface, "skills/list skill interface");
  const displayName = optionalString(interfaceRecord?.["displayName"]) ?? name;
  const description =
    optionalString(interfaceRecord?.["shortDescription"]) ??
    optionalString(skill["shortDescription"]) ??
    expectString(skill["description"], "skills/list skill description");
  return {
    description,
    displayName,
    enabled: expectBoolean(skill["enabled"], "skills/list skill enabled"),
    id: createSkillId(name, path),
    name,
    path,
    scope,
  };
}

export function requestIdKey(id: RpcRequestId): string {
  return `${typeof id}:${String(id)}`;
}

function isConfirmationOptions(options: readonly { label: string }[]): boolean {
  if (options.length !== 2) {
    return false;
  }
  const labels = new Set(options.map((option) => option.label.trim().toLocaleLowerCase()));
  return [
    ["yes", "no"],
    ["是", "否"],
    ["确认", "取消"],
    ["allow", "deny"],
    ["accept", "decline"],
  ].some((pair) => pair.every((label) => labels.has(label)));
}

export function mapUserInputQuestions(value: unknown): PendingUserInputQuestion[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
    throw new CodexProtocolMappingError("Codex user input questions must contain 1 to 3 items");
  }
  return value.map((questionValue) => {
    const question = expectRecord(questionValue, "Codex user input question");
    const nativeOptions = question["options"] ?? null;
    if (nativeOptions !== null && !Array.isArray(nativeOptions)) {
      throw new CodexProtocolMappingError("Codex user input options must be an array or null");
    }
    const isOther =
      question["isOther"] === undefined
        ? false
        : expectBoolean(question["isOther"], "Codex user input question isOther");
    const options = (nativeOptions ?? []).map((optionValue) => {
      const option = expectRecord(optionValue, "Codex user input option");
      return {
        description: expectString(option["description"], "Codex user input option description"),
        label: expectString(option["label"], "Codex user input option label"),
      };
    });
    if (nativeOptions !== null && options.length === 0 && !isOther) {
      throw new CodexProtocolMappingError("Codex choice question has no available answer");
    }
    const mappedQuestion = {
      header: expectString(question["header"], "Codex user input question header"),
      id: expectString(question["id"], "Codex user input question id"),
      isOther,
      isSecret:
        question["isSecret"] === undefined
          ? false
          : expectBoolean(question["isSecret"], "Codex user input question isSecret"),
      options,
      prompt: expectString(question["question"], "Codex user input question prompt"),
    };
    if (nativeOptions === null) {
      return { ...mappedQuestion, type: "short_text" };
    }
    if (isConfirmationOptions(options) && !isOther) {
      return { ...mappedQuestion, isOther: false, type: "confirmation" };
    }
    return { ...mappedQuestion, type: "choice" };
  });
}

export function userInputAnswersMatchRequest(
  request: Extract<PendingRequest, { type: "user_input" }>,
  answers: Readonly<Record<string, readonly string[]>>,
): boolean {
  const answerIds = Object.keys(answers);
  const questionIds = new Set(request.questions.map((question) => question.id));
  if (answerIds.length !== questionIds.size || answerIds.some((id) => !questionIds.has(id))) {
    return false;
  }
  // 当前统一协议只提供单选、确认和短文本；固定选项不能接受任意值。
  return request.questions.every((question) => {
    const values = answers[question.id];
    const answer = values?.[0];
    if (values?.length !== 1 || answer === undefined || answer.trim().length === 0) {
      return false;
    }
    if (question.type === "short_text" || question.isOther) {
      return true;
    }
    return question.options.some((option) => option.label === answer);
  });
}

export function toDateTime(value: unknown, context: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CodexProtocolMappingError(`${context} must be a Unix timestamp`);
  }
  return new Date(value * 1_000).toISOString();
}

export function toNullableDateTime(value: unknown, context: string): string | null {
  return value === null || value === undefined ? null : toDateTime(value, context);
}
