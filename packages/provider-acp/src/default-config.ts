import {
  hasAcpAgentConnection,
  type AcpAgentProfile,
  type AcpConfigValues,
  type AgentEngine,
  type AcpConfigOption,
  type AcpDefaults,
  type AcpSettingsSnapshot,
} from "@codexly/protocol";
import type { AcpConnection } from "./connection.js";
import type { AcpSettingsStore, AcpStoredSettings } from "./settings-store.js";
import { applyAcpConfig, prepareAcpDefaults } from "./configuration.js";
import { acpSelectOptions } from "./session-options.js";
import { waitForAcpPreview } from "./config-preview.js";

/** 只读快照已经拿到配置，短时等待释放；失去响应由宿主回收独占进程。 */
export function closeAcpSettingsSession(connection: AcpConnection, id: string, snapshot: boolean) {
  return waitForAcpPreview(
    connection.closeSession(id),
    snapshot ? AbortSignal.timeout(1_000) : undefined,
  );
}

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
    return await inspectAcpSessionDefaults(connection, store, engine, session, values);
  } finally {
    await closeSession(session.sessionId);
  }
}

/** 认证已创建辅助会话时，直接读取该会话公布的默认选项。 */
export async function inspectAcpSessionDefaults(
  connection: AcpConnection,
  store: AcpSettingsStore,
  engine: AgentEngine,
  session: { sessionId: string; configOptions: AcpConfigOption[] },
  values?: AcpConfigValues,
) {
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
}

export function projectAcpDefaults(
  validated: Awaited<ReturnType<typeof inspectAcpSessionDefaults>>,
) {
  const { configOptions, defaults, migration, invalidDefaults } = validated;
  return {
    configOptions,
    defaults,
    unmappedLegacy: [
      ...new Set([...(migration?.unmapped ?? []), ...Object.keys(validated.retainedValues ?? {})]),
    ],
    invalidDefaults,
  };
}

export type InspectWithSession = (
  onSession: (connection: AcpConnection, sessionId: string) => Promise<void>,
) => Promise<AcpAgentProfile>;

/** Antigravity 已用会话确认登录时，直接复用这次协商得到的选项。 */
export async function readAcpSettingsConfiguration(
  engine: AgentEngine,
  store: AcpSettingsStore,
  signal: AbortSignal,
  inspect: InspectWithSession,
  readDefaults: () => Promise<AcpDefaults>,
): Promise<AcpSettingsSnapshot> {
  let defaults: AcpDefaults | undefined;
  const profile = await inspect(async (connection, sessionId) => {
    defaults = projectAcpDefaults(
      await inspectAcpSessionDefaults(connection, store, engine, {
        sessionId,
        configOptions: connection.readSessionState(sessionId).configOptions,
      }),
    );
  });
  signal.throwIfAborted();
  if (!hasAcpAgentConnection(profile)) return { profile };
  return { profile, defaults: defaults ?? (await readDefaults()) };
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
