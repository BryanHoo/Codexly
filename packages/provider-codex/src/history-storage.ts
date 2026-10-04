import type { HistoryCompressionResult } from "@codexly/protocol";
import type { CodexRpcClient } from "./agent-provider-base.js";
import { expectRecord } from "./codex-mapping-common.js";

export function createHistoryStorage(client: CodexRpcClient) {
  let pending: Promise<HistoryCompressionResult> | undefined;
  return {
    compress(): Promise<HistoryCompressionResult> {
      // 仅合并在途请求；跨进程锁、冷文件筛选和并发预算交给 Codex 原生 worker。
      pending ??= client
        .request("rollout/compress", undefined)
        .then((response) => {
          expectRecord(response, "rollout/compress response");
          return { status: "scheduled" as const };
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}
