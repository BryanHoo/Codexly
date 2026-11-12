import { Value } from "@sinclair/typebox/value";
import type { Static, TSchema } from "@sinclair/typebox";
import type { AgentMessageAttachment } from "@codexly/protocol";
import {
  AcpPlanChangeSchema,
  AcpPlanPageSchema,
  AcpPlanHistorySchema,
  AcpPlanViewSchema,
  AcpPlanResourceSchema,
  DeleteAcpPlanResponseSchema,
  type SaveAcpPlan,
  type ListAcpPlans,
} from "@codexly/protocol/acp-plan-api";
import { TauriAcpClient } from "./acp-client.js";
import type { ReadOptions, MutationOptions } from "@/platform/native-client-types.js";
/** 计划管理走已注册白名单，不初始化旧厂商运行时；响应在跨 IPC 边界严格解码。 */
export class TauriAcpPlanClient extends TauriAcpClient {
  #subscription: { listeners: Set<() => void>; stop?: () => void } | undefined;
  subscribeAcpPlans(listener: () => void): () => void {
    let state = this.#subscription;
    if (state) {
      const shared = state;
      shared.listeners.add(listener);
      if (shared.stop)
        queueMicrotask(() => {
          if (this.#subscription === shared && shared.listeners.has(listener)) listener();
        });
    } else {
      state = { listeners: new Set([listener]) };
      this.#subscription = state;
      const registration = state;
      // 先注册原生监听，再校准遗漏的提交；卸载早于注册完成时同样释放监听。
      void import("@tauri-apps/api/event")
        .then(async ({ listen }) => {
          const stop = await listen<unknown>("acp-plan://changed", (event) => {
            if (
              this.#subscription !== registration ||
              !Value.Check(AcpPlanChangeSchema, event.payload)
            )
              return;
            for (const notify of registration.listeners) notify();
          });
          if (this.#subscription !== registration) {
            stop();
            return;
          }
          registration.stop = stop;
          for (const notify of registration.listeners) notify();
        })
        .catch(() => {
          /* 原生注册失败保留显式刷新，不增加轮询或启动旧引擎。 */
        });
    }
    const subscribed = state;
    return () => {
      subscribed.listeners.delete(listener);
      if (!subscribed.listeners.size && this.#subscription === subscribed) {
        this.#subscription = undefined;
        subscribed.stop?.();
      }
    };
  }

  private async plan<T extends TSchema>(
    request: Record<string, unknown>,
    schema: T,
    options: ReadOptions,
  ): Promise<Static<T>> {
    const data: unknown = await this.callCancellable(
      "acp_plan_request",
      { request },
      options.signal,
    );
    if (!Value.Check(schema, data)) throw new TypeError("Invalid ACP plan response");
    return data;
  }
  listAcpPlans(query: ListAcpPlans = {}, options: ReadOptions = {}) {
    return this.plan({ type: "list", ...query }, AcpPlanPageSchema, options);
  }
  readAcpPlan(planId: string, options: ReadOptions = {}) {
    return this.plan({ type: "read", planId }, AcpPlanViewSchema, options);
  }
  readAcpPlanHistory(planId: string, options: ReadOptions = {}) {
    return this.plan({ type: "history", planId }, AcpPlanHistorySchema, options);
  }
  saveAcpPlan(planId: string, input: SaveAcpPlan, options: MutationOptions = {}) {
    return this.plan({ type: "save", planId, input }, AcpPlanViewSchema, options);
  }
  deleteAcpPlan(planId: string, expectedRevision: number, options: MutationOptions = {}) {
    return this.plan(
      { type: "delete", planId, expectedRevision },
      DeleteAcpPlanResponseSchema,
      options,
    );
  }
  stageAcpPlanAttachment(
    planId: string,
    projectId: string,
    attachment: AgentMessageAttachment,
    options: MutationOptions = {},
  ) {
    return this.plan(
      { type: "stage", planId, projectId, attachment },
      AcpPlanResourceSchema,
      options,
    );
  }
}
