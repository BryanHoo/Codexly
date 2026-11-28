import type { AgentTaskScope } from "@codexly/core";
import type { AgentEngine, CodefreeQuotaView } from "@codexly/protocol";
import type { AcpClientCallbacks, AcpConnection } from "./connection.js";

/** Web 与独立桌面宿主只替换进程交付，ACP 会话实现保持共用。 */
export interface AcpAgentHandle {
  connection: AcpConnection;
  readCodefreeQuota?(signal?: AbortSignal): Promise<CodefreeQuotaView>;
  close(): Promise<void>;
}
export interface AcpAgentLaunchOptions {
  /** 全局设置进程可在 Agent 未启用时检测连接、登录和配置 API。 */
  allowDisabled?: boolean;
  codefreeLogin?: boolean;
  signal?: AbortSignal;
  handshakeTimeoutMs?: number;
  onStderrLine?: (line: string) => void;
}
export type AcpAgentLauncher = (
  engine: AgentEngine,
  scope: AgentTaskScope,
  callbacks: AcpClientCallbacks,
  options?: AcpAgentLaunchOptions,
) => Promise<AcpAgentHandle>;
import { setTimeout } from "node:timers/promises";

/** 启动和退出均可能失去响应。等待有界，迟到的句柄仍会被回收。 */
export async function closeAcpAgentHandle(launched: Promise<AcpAgentHandle>): Promise<void> {
  const timer = new AbortController();
  const cleanup = launched.then(
    async (handle) => {
      handle.connection.close();
      await handle.close();
    },
    () => undefined,
  );
  try {
    await Promise.race([
      cleanup,
      setTimeout(1_000, undefined, { ref: false, signal: timer.signal }),
    ]);
  } finally {
    timer.abort();
  }
}
