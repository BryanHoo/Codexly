import type { ReadTaskOptions } from "@/platform/native-client-types.js";
import type { AgentTaskSnapshotResponse } from "@/protocol/index.js";
import { TauriRuntimeClient } from "./runtime-client.js";
import { v4 as createUuid } from "uuid";

/** 公共主/子任务入口共享运行时选择，ACP 失败不能回退到旧厂商命令。 */
export class TauriTaskLifecycleClient extends TauriRuntimeClient {
  readonly #leases = new Map<string, string>();
  readonly #operations = new Map<string, Promise<void>>();

  public async readTask(
    projectId: string,
    taskId: string,
    options: ReadTaskOptions = {},
  ): Promise<AgentTaskSnapshotResponse> {
    options.signal?.throwIfAborted();
    if ((await this.applicationRuntime()) === "acp")
      return this.getAcpTask(projectId, taskId, options);
    const response = await this.callCancellable<AgentTaskSnapshotResponse>(
      "read_task",
      {
        projectId,
        taskId,
        cursor: options.cursor ?? null,
        ...(options.summary === undefined ? {} : { summary: options.summary }),
      },
      options.signal,
    );
    this.taskProjects.set(response.snapshot.id, projectId);
    return response;
  }

  public retainTaskSubscription(projectId: string, taskId: string): Promise<void> {
    return this.#subscription(projectId, taskId, true);
  }

  public releaseTaskSubscription(projectId: string, taskId: string): Promise<void> {
    return this.#subscription(projectId, taskId, false);
  }

  protected forgetTaskSubscription(projectId: string, taskId: string): Promise<void> {
    const key = JSON.stringify([projectId, taskId]);
    const forget = () => {
      this.#leases.delete(key);
      this.taskProjects.delete(taskId);
      return Promise.resolve();
    };
    // 没有本任务在途操作时直接清理；其他任务的容量不能把已确认删除误报成失败。
    return this.#operations.has(key) ? this.#serial(key, forget) : forget();
  }

  #subscription(projectId: string, taskId: string, retain: boolean): Promise<void> {
    const key = JSON.stringify([projectId, taskId]);
    return this.#serial(key, async () => {
      if ((await this.applicationRuntime()) !== "acp") {
        await this.call(retain ? "retain_task_subscription" : "release_task_subscription", {
          projectId,
          taskId,
        });
        return;
      }
      let leaseId = this.#leases.get(key);
      if (!leaseId) {
        if (!retain) return;
        if (this.#leases.size >= 512) throw new Error("任务订阅已达上限");
        // ProjectRuntime 合并同客户端同任务的多个视图；重试复用身份，不能重复计数。
        // 沿用项目 UUID 库，兼容仅支持 getRandomValues 的旧 WebKit。
        leaseId = createUuid();
        this.#leases.set(key, leaseId);
      }
      this.taskProjects.set(taskId, projectId);
      await this.call("acp_task_request", {
        projectId,
        method: retain ? "task.retain" : "task.release",
        params: { taskId, leaseId },
      });
      // 成功释放才清身份；失败保留以便幂等重试。重挂排在释放之后生成新身份。
      if (!retain) this.#leases.delete(key);
    });
  }

  #serial(key: string, action: () => Promise<void>): Promise<void> {
    if (!this.#operations.has(key) && this.#operations.size >= 512)
      return Promise.reject(new Error("任务订阅操作已达上限"));
    const operation = (this.#operations.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(action)
      .finally(() => {
        if (this.#operations.get(key) === operation) this.#operations.delete(key);
      });
    this.#operations.set(key, operation);
    return operation;
  }
}
