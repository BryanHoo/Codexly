import type { AcpPlanRun, LocalCatalogStore } from "@codexly/core";
import type { AcpPlanRunSummary } from "@codexly/protocol/acp-plan-api";
const stamp = (run: AcpPlanRunSummary | null) =>
  JSON.stringify([run?.status, run?.taskId, run?.error]);
/** 通知不承载正文，也不能改变执行成功 / 失败语义；无人订阅时不增加目录读取。 */
export class AcpPlanChanges {
  readonly #listeners = new Set<() => void>();
  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  publish() {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        /* 消费者故障不能使已持久提交看似失败。 */
      }
    }
  }
  observe(
    catalog: LocalCatalogStore,
    execute: (id: string, run: string) => Promise<AcpPlanRun | null>,
  ) {
    return async (id: string, runId: string) => {
      if (!this.#listeners.size) return execute(id, runId);
      const key = { source: "web" as const, scheduleId: id, runId };
      const before = await catalog.catalog("acp.plan.summary", key).catch(() => null);
      if (before?.status === "claimed") this.publish();
      try {
        const result = await execute(id, runId);
        if (stamp(before) !== stamp(result)) this.publish();
        return result;
      } catch (error) {
        // 执行可能已写入 unknown 才抛错；仅校准实际变化，原始错误仍由调度器记录。
        const after = await catalog.catalog("acp.plan.summary", key).catch(() => before);
        if (stamp(before) !== stamp(after)) this.publish();
        throw error;
      }
    };
  }
}
