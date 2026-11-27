import type { AcpConfigValues, AgentEngine } from "@codexly/protocol";
import type { AcpConnection } from "./connection.js";
import type { AcpSettingsStore, AcpStoredSettings } from "./settings-store.js";
import { applyAcpConfig, prepareAcpDefaults } from "./configuration.js";
import { acpSelectOptions } from "./session-options.js";

function baseline(settings: AcpStoredSettings): string {
  return JSON.stringify([
    settings.configured,
    settings.values,
    settings.retainedValues,
    settings.legacy,
    settings.legacyPolicy,
  ]);
}

/** 读取或校验全局默认值时借用辅助会话，在关闭成功后才交回配置。 */
export async function readAcpDefaults(
  connection: AcpConnection,
  store: AcpSettingsStore,
  engine: AgentEngine,
  cwd: string,
  values: AcpConfigValues | undefined,
  closeSession: (sessionId: string) => Promise<void>,
  registerSession: (sessionId: string) => Promise<void>,
) {
  const session = await connection.newSession({ cwd, mcpServers: [] });
  try {
    await registerSession(session.sessionId);
    const current = values === undefined ? await store.inspect(engine) : await store.read(engine);
    const prepared = await prepareAcpDefaults(
      connection,
      session.sessionId,
      session.configOptions,
      current,
      values,
      values === undefined,
    );
    return { ...prepared, retainedValues: current.retainedValues };
  } finally {
    await closeSession(session.sessionId);
  }
}

/** 单项设置先恢复当前默认值，再按 agent 完整响应收敛；不重送已失效的依赖值。 */
export async function setAcpDefaultConfig(
  connection: AcpConnection,
  store: AcpSettingsStore,
  engine: AgentEngine,
  cwd: string,
  configId: string,
  value: string | boolean,
  closeSession: (sessionId: string) => Promise<void>,
  registerSession: (sessionId: string) => Promise<void>,
) {
  const session = await connection.newSession({ cwd, mcpServers: [] });
  const result = await (async () => {
    try {
      await registerSession(session.sessionId);
      const saved = await store.read(engine);
      const current = await prepareAcpDefaults(
        connection,
        session.sessionId,
        session.configOptions,
        saved,
        undefined,
        true,
      );
      const configOptions = await applyAcpConfig(
        connection,
        session.sessionId,
        current.configOptions,
        { [configId]: value },
      );
      const byId = new Map(configOptions.map((option) => [option.id, option]));
      const defaults = new Map<string, string | boolean>();
      const retainedValues = new Map(Object.entries(saved.retainedValues ?? {}));
      for (const [id, previous] of Object.entries({ ...current.defaults, [configId]: value })) {
        const option = byId.get(id);
        const valid =
          option &&
          (option.type === "boolean" ||
            acpSelectOptions(option.options).some(
              (choice) => choice.value === option.currentValue,
            ));
        if (option && valid) {
          defaults.set(id, option.currentValue);
          if (previous !== option.currentValue) retainedValues.set(id, previous);
          else if (id === configId) retainedValues.delete(id);
        } else retainedValues.set(id, previous);
      }
      // Map/Record 转换保留 __proto__ 等合法原始 ID，不使用对象原型赋值语义。
      return {
        saved,
        configOptions,
        defaults: Object.fromEntries(defaults),
        retainedValues: Object.fromEntries(retainedValues),
        migration: current.migration,
      };
    } finally {
      // 校验成功但会话关闭失败时仍不落盘，沿用全局设置服务的真实失败语义。
      await closeSession(session.sessionId);
    }
  })();
  await store.update(engine, (latest) => {
    // 持锁后重新核对基线；另一宿主在 ACP 往返期间修改的值不能被旧响应覆盖。
    if (baseline(latest) !== baseline(result.saved))
      throw new Error("ACP 默认设置已变化，请重新读取");
    return {
      ...latest,
      configured: true,
      values: result.defaults,
      retainedValues: result.retainedValues,
      ...(result.migration ? { migration: result.migration } : {}),
    };
  });
  return {
    configOptions: result.configOptions,
    defaults: result.defaults,
    unmappedLegacy: [
      ...new Set([...(result.migration?.unmapped ?? []), ...Object.keys(result.retainedValues)]),
    ],
    invalidDefaults: [],
  };
}
