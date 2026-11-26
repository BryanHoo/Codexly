import type { AcpPlanDueCursor, AcpPlanRunReference, LocalCatalogStore } from "@codexly/core";
import { randomUUID } from "node:crypto";
import { previewScheduledTask } from "./scheduled-task-recurrence.js";

/** 调用式发现不启动后台循环；规则计算完成后，再由数据库 CAS 确认计划仍可领取。 */
export async function discoverDueAcpPlans(
  store: LocalCatalogStore,
  now: number,
  limit = 20,
  after?: AcpPlanDueCursor | null,
): Promise<{
  nextCursor: AcpPlanDueCursor | null;
  claims: AcpPlanRunReference[];
  errors: { scheduleId: string; message: string }[];
}> {
  const due = await store.catalog("acp.plan.due", {
    source: "web",
    now,
    limit,
    ...(after ? { after } : {}),
  });
  const claims: AcpPlanRunReference[] = [],
    errors: { scheduleId: string; message: string }[] = [];
  for (const item of due) {
    try {
      if (item.stateRevision === null) throw new Error("ACP plan is not armed");
      if (item.schedule.type === "once" && item.schedule.atUnixMs > now)
        throw new Error("ACP plan cursor is before its occurrence");
      const nextRunAt = (await previewScheduledTask(item.schedule, now, 1))[0] ?? null;
      const claimed = await store.catalog("acp.plan.claimRef", {
        source: "web",
        scheduleId: item.scheduleId,
        expectedRevision: item.revision,
        expectedStateRevision: item.stateRevision,
        now,
        nextRunAt,
        runId: randomUUID(),
      });
      if (claimed) claims.push(claimed);
    } catch (cause) {
      // 单项规则失败保留原游标；其余到期项继续计算，不占用数据库或运行时互斥。
      errors.push({
        scheduleId: item.scheduleId,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  const last = due.at(-1);
  const nextCursor =
    due.length === limit && last?.nextRunAt !== null && last !== undefined
      ? { nextRunAt: last.nextRunAt, scheduleId: last.scheduleId }
      : null;
  return { claims, errors, nextCursor };
}
