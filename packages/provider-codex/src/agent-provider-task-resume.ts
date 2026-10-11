import { CodexAgentProviderTasks } from "./agent-provider-tasks.js";
import { assertProjectThread } from "./agent-provider-base.js";
import {
  CODEX_THREAD_CONFIG,
  CodexProtocolMappingError,
  expectRecord,
  expectString,
} from "./codex-protocol-mapping.js";

export abstract class CodexAgentProviderTaskResume extends CodexAgentProviderTasks {
  protected async resumeTask(taskId: string): Promise<void> {
    if (this.runtime.resumedTaskIds.has(taskId)) {
      return;
    }
    const currentResume = this.runtime.resumePromises.get(taskId);
    if (currentResume !== undefined) {
      return currentResume;
    }

    const resumePromise = (async () => {
      const response = expectRecord(
        await this.client.request("thread/resume", {
          config: CODEX_THREAD_CONFIG,
          // 恢复只负责加载运行时，Snapshot 历史继续通过分页接口获取。
          excludeTurns: true,
          // 恢复 Project Task 时覆盖旧运行时配置，使全部根立即生效。
          ...(this.project.kind === "project"
            ? {
                runtimeWorkspaceRoots: this.runtime.workspaceRootsForTask(
                  taskId,
                  this.project.runtimeWorkspaceRoots,
                ),
              }
            : {}),
          threadId: taskId,
        }),
        "thread/resume response",
      );
      const thread = expectRecord(response["thread"], "thread/resume thread");
      if (expectString(thread["id"], "thread/resume thread id") !== taskId) {
        throw new CodexProtocolMappingError("thread/resume returned a different thread");
      }
      await assertProjectThread(thread, this.project);
      // 恢复成功后，本次 App Server 生命周期内可直接继续后续 Turn。
      this.runtime.resumedTaskIds.add(taskId);
    })();
    this.runtime.resumePromises.set(taskId, resumePromise);
    try {
      await resumePromise;
    } finally {
      if (this.runtime.resumePromises.get(taskId) === resumePromise) {
        this.runtime.resumePromises.delete(taskId);
      }
    }
  }
}
