import { Value } from "@sinclair/typebox/value";
import { ClaudePermissionModeSchema } from "@codexly/protocol";
import type { AgentProviderEventListener } from "@codexly/core";
import type { ClaudeSessionSettings } from "./session-settings.js";
import type { ClaudeSessionGrants } from "./session-grants.js";
import type { ClaudeTurnProjection } from "./turn-projection.js";

/** 仅接受 SDK 已确认的已知模式；状态通知只观察，禁止反向控制覆盖 Claude 自主切换。 */
export function observePermissionMode(
  id: string,
  running: {
    settings: ClaudeSessionSettings;
    grants: ClaudeSessionGrants;
    projection: ClaudeTurnProjection;
    projections: ReadonlyMap<string, ClaudeTurnProjection>;
  },
  value: unknown,
  emit: AgentProviderEventListener,
): boolean {
  if (!Value.Check(ClaudePermissionModeSchema, value)) return false;
  running.settings.permissionMode = value;
  running.grants.observeMode(value);
  if (running.projection.permissionMode === value) return false;
  // 后台旧回合共享主会话权限，防止迟到持久化把已确认的模式写回旧值。
  for (const projection of running.projections.values()) projection.permissionMode = value;
  emit({ type: "task.metadata_changed", taskId: id, payload: { permissionMode: value } });
  return true;
}
