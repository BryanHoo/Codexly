import type {
  AgentCapabilities,
  SessionConfigOption,
  SessionConfigSelectOptions,
} from "@agentclientprotocol/sdk/unstable";
import type { LocalTask } from "@codexly/core";
import type { AcpSettingsMigration, AcpTaskBinding } from "@codexly/protocol";

export function bindAcpTask(
  task: Pick<LocalTask, "id" | "provider" | "sessionId" | "cwd">,
): AcpTaskBinding {
  if (task.provider !== "codex" && task.provider !== "claude")
    throw new Error("无法迁移未知引擎的任务");
  if (!task.id || !task.cwd || task.sessionId === "") throw new Error("历史任务身份不完整");
  return { taskId: task.id, engine: task.provider, sessionId: task.sessionId, cwd: task.cwd };
}

export function selectSessionOperation(
  sessionId: string | null,
  capabilities: AgentCapabilities,
  replayHistory: boolean,
): "new" | "load" | "resume" {
  if (sessionId === null) return "new";
  if (!sessionId) throw new Error("历史会话标识无效");
  // 已有可靠本地投影时才允许不重放恢复；不能拿 resume 代替读取旧历史。
  if (!replayHistory && capabilities.sessionCapabilities?.resume) return "resume";
  if (capabilities.loadSession) return "load";
  throw new Error("ACP agent 不支持所需的历史恢复能力，原任务保持不变");
}

function selectValues(options: SessionConfigSelectOptions): string[] {
  return options.flatMap((option) =>
    "group" in option ? option.options.map((child) => child.value) : [option.value],
  );
}

function isMigration(value: Readonly<Record<string, unknown>>): value is AcpSettingsMigration {
  return (
    value["format"] === "acp-settings-migration" &&
    value["version"] === 1 &&
    value["legacy"] !== null &&
    typeof value["legacy"] === "object" &&
    !Array.isArray(value["legacy"]) &&
    Array.isArray(value["unmapped"])
  );
}

/** 迁移只接受 agent 公布的精确值；不把旧权限枚举猜测成宽松的 ACP mode。 */
export function migrateAcpSettings(
  source: Readonly<Record<string, unknown>>,
  options: readonly SessionConfigOption[],
): AcpSettingsMigration {
  const legacy = structuredClone(isMigration(source) ? source.legacy : source);
  const migrated = new Map<string, string | boolean>();
  const unmapped: string[] = [];
  for (const [key, value] of Object.entries(legacy)) {
    const category =
      key === "model"
        ? "model"
        : key === "reasoningEffort"
          ? "thought_level"
          : key === "permissionMode"
            ? "mode"
            : undefined;
    const target =
      options.find((option) => option.id === key) ??
      (category ? options.find((option) => option.category === category) : undefined);
    const valid =
      target &&
      (target.type === "boolean"
        ? typeof value === "boolean"
        : typeof value === "string" && selectValues(target.options).includes(value));
    if (
      !valid ||
      (typeof value !== "boolean" && typeof value !== "string") ||
      (migrated.has(target.id) && migrated.get(target.id) !== value)
    ) {
      unmapped.push(key);
      continue;
    }
    migrated.set(target.id, value);
  }
  return {
    format: "acp-settings-migration",
    version: 1,
    legacy,
    values: Object.fromEntries(migrated),
    unmapped,
  };
}
