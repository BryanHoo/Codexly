import type { AcpConfigValues, AcpConfigPreviewRequest } from "@codexly/protocol";
import type { AcpConnection } from "./connection.js";
import type { AcpStoredSettings } from "./settings-store.js";
import { applyAcpConfig, prepareAcpDefaults } from "./configuration.js";

/** 草稿协商只借用配置快照，不接收仓储写入或应用任务创建端口。 */
export async function previewAcpConfig(
  connection: AcpConnection,
  cwd: string,
  saved: AcpStoredSettings,
  values: AcpConfigValues,
  change?: AcpConfigPreviewRequest["change"],
) {
  if (!connection.initialization.agentCapabilities?.sessionCapabilities?.close)
    throw new Error("ACP agent 不支持预览会话关闭");
  const session = await connection.newSession({ cwd, mcpServers: [] });
  try {
    // 先恢复仍有效的默认值；草稿显式选择严格校验，不写全局默认设置。
    const current = await prepareAcpDefaults(
      connection,
      session.sessionId,
      session.configOptions ?? [],
      saved,
      undefined,
      true,
    );
    let configOptions = await applyAcpConfig(
      connection,
      session.sessionId,
      current.configOptions,
      values,
      change ? [] : undefined,
    );
    if (change)
      configOptions = await applyAcpConfig(connection, session.sessionId, configOptions, {
        [change.configId]: change.value,
      });
    return {
      configOptions,
      values: Object.fromEntries(configOptions.map((option) => [option.id, option.currentValue])),
    };
  } finally {
    // 关闭失败必须向上报告，不能把泄漏的会话当作成功预览。
    await connection.closeSession(session.sessionId);
  }
}
