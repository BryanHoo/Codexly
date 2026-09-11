import { isDeepStrictEqual } from "node:util";
import type { AgentRuntimeDefaultSettings } from "@codexly/core";
import type { AgentGlobalSettings } from "@codexly/protocol";
import type { ServerRouteContext } from "./routes/context.js";

const agentFields = [
  "approvalPolicy",
  "approvalsReviewer",
  "model",
  "reasoningEffort",
  "sandboxMode",
  "fastMode",
] as const;

export function createGlobalSettingsWriter(
  context: Pick<
    ServerRouteContext,
    "readEffectiveGlobalSettings" | "settingsRepository" | "provider"
  >,
) {
  let queue: Promise<unknown> = Promise.resolve();
  return (settings: AgentGlobalSettings): Promise<AgentGlobalSettings> => {
    // 同一服务实例串行执行比较、Codex 写入与本地保存，防止并发请求使用旧快照。
    const result = queue
      .catch(() => undefined)
      .then(async () => {
        const current = await context.readEffectiveGlobalSettings();
        const changed: AgentRuntimeDefaultSettings = Object.fromEntries(
          agentFields
            .filter((key) => !isDeepStrictEqual(current[key], settings[key]))
            .map((key) => [key, settings[key]]),
        );
        if (Object.keys(changed).length > 0) await context.provider.updateDefaultSettings(changed);
        // Codex 拒绝修改时不能把本地快照保存为成功；应用偏好不写入 config.toml。
        await context.settingsRepository.writeGlobalSettings(settings);
        return context.readEffectiveGlobalSettings();
      });
    queue = result;
    return result;
  };
}
