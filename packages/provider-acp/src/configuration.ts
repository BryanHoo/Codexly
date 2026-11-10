import type * as acp from "@agentclientprotocol/sdk/unstable";
import type { AcpConfigValues } from "@codexly/protocol";
import type { AcpConnection } from "./connection.js";
import type { AcpStoredSettings } from "./settings-store.js";
import { migrateAcpSettings } from "./migration.js";
import { acpSelectOptions } from "./session-options.js";

/** 每次设置响应都以 agent 返回的完整列表替换旧列表，模型切换可能改变后续选项。 */
export async function applyAcpConfig(
  connection: AcpConnection,
  sessionId: string,
  initial: acp.SessionConfigOption[],
  values: AcpConfigValues,
  invalid?: string[],
): Promise<acp.SessionConfigOption[]> {
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
  initial: acp.SessionConfigOption[],
  saved: AcpStoredSettings,
  requested?: AcpConfigValues,
  inspect = false,
) {
  let options = initial;
  if (!requested && !saved.configured && saved.legacy) {
    const mapped = migrateAcpSettings(saved.legacy, options);
    const model = options.find((option) => option.category === "model");
    const value = model ? mapped.values[model.id] : undefined;
    if (model && value !== undefined)
      options = await applyAcpConfig(connection, sessionId, options, { [model.id]: value });
  }
  const migration = saved.legacy ? migrateAcpSettings(saved.legacy, options) : undefined;
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
