import type { AgentSettingsRepository } from "@codexly/core";
import type { AgentTaskSettings } from "@codexly/protocol";

/** 空任务只继承已保存的应用偏好；模型目录校验延后到实际执行，避免管理依赖引擎在线。 */
export async function readLocalTaskCreationSettings(
  repository: AgentSettingsRepository,
  projectId: string,
): Promise<AgentTaskSettings | undefined> {
  const settings =
    (await repository.readProjectDefaults(projectId)) ?? (await repository.readGlobalSettings());
  if (settings === undefined) return undefined;
  return {
    model: settings.model,
    reasoningEffort: settings.reasoningEffort,
    sandboxMode: settings.sandboxMode,
    approvalPolicy: settings.approvalPolicy,
    approvalsReviewer: settings.approvalsReviewer,
  };
}
