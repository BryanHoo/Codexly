import { observePermissionMode } from "./permission-mode-observer.js";
export { observePermissionMode } from "./permission-mode-observer.js";
import type { ClaudePermissionMode } from "@codexly/protocol";
import type { AgentProviderEventListener } from "@codexly/core";
import { scheduleIdle, type Running } from "./session.js";
import type { ClaudeConfiguration } from "./config.js";
import type { ClaudeSessionGrants } from "./session-grants.js";

/** 原生确认前不保存选择；与回合启动共用占用标记，保证控制期间不会换掉 Query。 */
export async function updatePermissionMode(
  id: string,
  mode: ClaudePermissionMode,
  context: {
    starting: Set<string>;
    running: Running | undefined;
    grants: ClaudeSessionGrants | undefined;
    config: ClaudeConfiguration;
    validate: () => Promise<unknown>;
    emit: AgentProviderEventListener;
  },
): Promise<void> {
  const { starting, running, grants, config, validate, emit } = context;
  if (starting.has(id)) throw new Error("Claude 会话设置正在更新，请稍后重试");
  starting.add(id);
  clearTimeout(running?.idleTimer);
  if (running) running.idleTimer = undefined;
  try {
    await validate();
    if (running && !running.closed) {
      if (running.settings.permissionMode === mode && running.projection.permissionMode === mode)
        return;
      await running.query.setPermissionMode(mode);
      running.grants.confirmMode(mode);
      observePermissionMode(id, running, mode, emit);
      await config.history.saveMetadata(id, running.projection.metadata());
    } else {
      const metadata = await config.history.metadata(id);
      if (metadata) await config.history.saveMetadata(id, { ...metadata, permissionMode: mode });
      grants?.confirmMode(mode);
      emit({ type: "task.metadata_changed", taskId: id, payload: { permissionMode: mode } });
    }
  } finally {
    starting.delete(id);
    if (running && !running.closed) scheduleIdle(running, running.idleTimeoutMs);
  }
}
