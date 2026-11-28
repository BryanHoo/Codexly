import type { AcpConfigOption } from "@codexly/protocol";
import type { AcpConfigValues } from "@codexly/protocol";
import type { AcpConnection } from "./connection.js";
import type { AcpStoredSettings } from "./settings-store.js";
import { migrateAcpSettings } from "./migration.js";
import { acpSelectOptions } from "./session-options.js";
import type { LocalTask } from "@codexly/core";
import type { AgentTurnOptions } from "@codexly/protocol";
import type { AcpSessionInitialization } from "./session-initialization.js";

/** 发送前完成旧选项映射，并持久化 Agent 已确认值，保证重启后继续使用本任务配置。 */
export async function configureAcpTurn(
  connection: AcpConnection,
  sessionId: string,
  options: Partial<Pick<AgentTurnOptions, "model" | "reasoningEffort">> & {
    overrides?: AcpConfigValues | undefined;
  },
  task: LocalTask,
  initialization?: AcpSessionInitialization,
): Promise<void> {
  let current = connection.readSessionState(sessionId).configOptions;
  // 真实会话应用宿主默认值后，显式选项在本次发送的任务锁内生效。
  if (options.overrides)
    current = await applyAcpConfig(connection, sessionId, current, options.overrides);
  const selected = migrateAcpSettings(
    {
      ...(options.model ? { model: options.model } : {}),
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
    },
    current,
  );
  if (selected.unmapped.length) throw new Error("ACP agent 未提供选定的模型或思考配置");
  const confirmed = await applyAcpConfig(connection, sessionId, current, selected.values);
  await initialization?.saveConfiguration({ ...task, sessionId }, sessionId, confirmed);
}

/** 每次设置响应都以 agent 返回的完整列表替换旧列表，模型切换可能改变后续选项。 */
export async function applyAcpConfig(
  connection: AcpConnection,
  sessionId: string,
  initial: AcpConfigOption[],
  values: AcpConfigValues,
  invalid?: string[],
): Promise<AcpConfigOption[]> {
  let options = initial;
  const pending = new Map(Object.entries(values));
  while (pending.size) {
    // 模型优先；其余遵循 agent 的声明顺序，不依赖 HTTP 对象键顺序。
    const option =
      options.find((item) => item.category === "model" && pending.has(item.id)) ??
      options.find((item) => pending.has(item.id));
    if (!option) {
      if (!invalid) throw new Error("ACP 配置选项未公布");
      invalid.push(...pending.keys());
      break;
    }
    const value = pending.get(option.id);
    if (value === undefined) throw new Error("ACP 配置选项值缺失");
    if (
      option.type === "boolean"
        ? typeof value !== "boolean"
        : typeof value !== "string" ||
          !acpSelectOptions(option.options).some((item) => item.value === value)
    ) {
      if (!invalid) throw new Error("ACP 配置选项值未公布");
      invalid.push(option.id);
      pending.delete(option.id);
      continue;
    }
    pending.delete(option.id);
    if (option.currentValue === value) continue;
    options = (await connection.setConfigOption(sessionId, option.id, value)).configOptions;
  }
  return options;
}

/** 旧思考档位可能只在目标模型下公布：先切模型，再按新列表重新判断精确等价。 */
export async function prepareAcpDefaults(
  connection: AcpConnection,
  sessionId: string,
  initial: AcpConfigOption[],
  saved: AcpStoredSettings,
  requested?: AcpConfigValues,
  inspect = false,
) {
  let options = initial;
  // 已被原生配置覆盖的应用副本仅供恢复留档，不能重新覆盖 agent 当前值。
  const legacy = saved.legacyPolicy === "preserve" ? undefined : saved.legacy;
  if (!requested && !saved.configured && legacy) {
    const mapped = migrateAcpSettings(legacy, options);
    const model = options.find((option) => option.category === "model");
    const value = model ? mapped.values[model.id] : undefined;
    if (model && value !== undefined)
      options = await applyAcpConfig(connection, sessionId, options, { [model.id]: value });
  }
  const migration = legacy ? migrateAcpSettings(legacy, options) : undefined;
  const defaults =
    requested ?? (saved.configured ? saved.values : (migration?.values ?? saved.values));
  // 读取设置必须保留修正入口；实际保存与新会话执行仍严格拒绝过期默认值。
  const invalidDefaults: string[] = [];
  const configOptions = await applyAcpConfig(
    connection,
    sessionId,
    options,
    defaults,
    inspect ? invalidDefaults : undefined,
  );
  return { configOptions, defaults, migration, invalidDefaults };
}
