import type { AcpPlanDueCursor, LocalCatalogStore } from "@codexly/core";
import { discoverDueAcpPlans } from "./acp-plan-discovery.js";

export type AcpPlanScan =
  { phase: "recovery"; after?: string } | { phase: "due"; after?: AcpPlanDueCursor };
export interface AcpPlanBatch {
  next: AcpPlanScan | null;
  errors: { scheduleId: string; message: string }[];
}
export interface AcpPlanSchedulerPorts {
  catalog: LocalCatalogStore;
  execute: (scheduleId: string, runId: string) => Promise<unknown>;
  isClosed?: () => boolean;
}
export async function scanAcpPlanBatch(
  ports: AcpPlanSchedulerPorts,
  now: number,
  cursor: AcpPlanScan = { phase: "recovery" },
  limit = 20,
): Promise<AcpPlanBatch> {
  const errors: AcpPlanBatch["errors"] = [];
  const stopped = (): AcpPlanBatch => ({ next: { phase: "recovery" }, errors });
  if (ports.isClosed?.()) return stopped();
  let work: { scheduleId: string; runId: string }[];
  let next: AcpPlanScan | null;
  if (cursor.phase === "recovery") {
    const page = await ports.catalog.catalog("acp.plan.active", {
      source: "web",
      limit,
      ...(cursor.after === undefined ? {} : { after: cursor.after }),
    });
    work = page.data;
    next = page.nextCursor ? { phase: "recovery", after: page.nextCursor } : { phase: "due" };
  } else {
    const found = await discoverDueAcpPlans(ports.catalog, now, limit, cursor.after);
    work = found.claims;
    errors.push(...found.errors.map((e) => ({ ...e, message: e.message.slice(0, 2048) })));
    next = found.nextCursor ? { phase: "due", after: found.nextCursor } : null;
  }
  // 关闭只阻止新的执行，不中断已经进入持久提交流程的那一次调用。
  for (const item of work) {
    if (ports.isClosed?.()) return stopped();
    try {
      await ports.execute(item.scheduleId, item.runId);
    } catch (error) {
      errors.push({ scheduleId: item.scheduleId, message: String(error).slice(0, 2048) });
    }
  }
  return { next, errors };
}

export class AcpPlanScheduler {
  readonly #ports: AcpPlanSchedulerPorts & {
    now?: () => number;
    onError?: (error: { scheduleId: string; message: string }) => void;
  };
  readonly #clock: () => number;
  #cursor: AcpPlanScan = { phase: "recovery" };
  #at = 0;
  #newRound = true;
  #started = false;
  #closed = false;
  #wakeRequested = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | undefined;
  constructor(
    ports: AcpPlanSchedulerPorts & {
      now?: () => number;
      onError?: (error: { scheduleId: string; message: string }) => void;
    },
  ) {
    this.#ports = ports;
    this.#clock = ports.now ?? Date.now;
  }
  #isClosed = () => this.#closed || this.#ports.isClosed?.() === true;
  start(): void {
    if (this.#started || this.#closed) return;
    this.#started = true;
    this.wake();
  }
  wake(): void {
    if (!this.#started || this.#isClosed()) return;
    this.#wakeRequested = true;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    if (!this.#running) this.#schedule(0);
  }
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    // 不丢弃正在进入 ACP 的提交；关闭只阻止后续执行并等待当前批次交还控制权。
    await this.#running;
  }
  #report(error: { scheduleId: string; message: string }) {
    try {
      this.#ports.onError?.(error);
    } catch {
      /* 诊断回调不能中断已持久化运行的恢复。 */
    }
  }
  #schedule(delay: number) {
    if (this.#isClosed()) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#running = this.#tick()
        .catch((error: unknown) => {
          this.#newRound = true;
          this.#report({ scheduleId: "", message: String(error).slice(0, 2048) });
          return 60000;
        })
        .then((wait) => {
          this.#running = undefined;
          if (!this.#isClosed()) this.#schedule(this.#wakeRequested ? 0 : wait);
        });
    }, delay);
    this.#timer.unref();
  }
  async #tick(): Promise<number> {
    if (this.#newRound || this.#wakeRequested) {
      this.#cursor = { phase: "recovery" };
      this.#at = this.#clock();
      this.#newRound = false;
      this.#wakeRequested = false;
    }
    const batch = await scanAcpPlanBatch(
      { ...this.#ports, isClosed: this.#isClosed },
      this.#at,
      this.#cursor,
    );
    for (const error of batch.errors) this.#report(error);
    if (this.#isClosed()) return 60000;
    if (batch.next) {
      this.#cursor = batch.next;
      return 0;
    }
    const next = await this.#ports.catalog.catalog("acp.plan.nextDue", {
      source: "web",
      after: this.#at,
    });
    this.#newRound = true;
    // 只用精简游标安排下一轮；一分钟上限用于时钟跳变和外部写入复核。
    return next === null ? 60000 : Math.min(60000, Math.max(0, next - this.#clock()));
  }
}
