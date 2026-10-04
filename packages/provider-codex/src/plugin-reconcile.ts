import type { PluginReconcileResult } from "@codexly/protocol";
import {
  CodexProtocolMappingError,
  expectBoolean,
  expectRecord,
  expectString,
} from "./codex-mapping-common.js";

interface Client {
  request(method: string, params: unknown): Promise<unknown>;
}
const pending = new WeakMap<Client, Promise<PluginReconcileResult>>();

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value))
    throw new CodexProtocolMappingError(`plugin/reconcile ${name} must be an array`);
  return value;
}

async function reconcile(client: Client): Promise<PluginReconcileResult> {
  const result = expectRecord(
    await client.request("plugin/reconcile", { reason: "codexly.refresh" }),
    "plugin/reconcile response",
  );
  return {
    changedPlugins: array(result["changedPlugins"], "changedPlugins").map((value) => {
      const plugin = expectRecord(value, "plugin/reconcile plugin");
      const id = expectString(plugin["id"], "plugin/reconcile id");
      if (id.length === 0) throw new CodexProtocolMappingError("plugin/reconcile id is empty");
      return {
        id,
        hasApps: expectBoolean(plugin["hasApps"], "plugin/reconcile hasApps"),
        hasHooks: expectBoolean(plugin["hasHooks"], "plugin/reconcile hasHooks"),
        hasMcps: expectBoolean(plugin["hasMcps"], "plugin/reconcile hasMcps"),
        hasSkills: expectBoolean(plugin["hasSkills"], "plugin/reconcile hasSkills"),
      };
    }),
    failedRemotePluginIds: array(result["failedRemotePluginIds"], "failedRemotePluginIds").map(
      (id) => expectString(id, "plugin/reconcile failedRemotePluginId"),
    ),
    failedMaterializationRemotePluginIds: array(
      result["failedMaterializationRemotePluginIds"],
      "failedMaterializationRemotePluginIds",
    ).map((id) => expectString(id, "plugin/reconcile failedMaterializationRemotePluginId")),
  };
}

export function reconcileCodexPlugins(client: Client): Promise<PluginReconcileResult> {
  const existing = pending.get(client);
  if (existing !== undefined) return existing;
  // 仅合并同一运行时的在途同步；完成或失败后释放，下一次刷新重新向 Codex 查询。
  const request = reconcile(client).finally(() => pending.delete(client));
  pending.set(client, request);
  return request;
}
