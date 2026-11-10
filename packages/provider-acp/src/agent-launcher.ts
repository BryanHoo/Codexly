import type { AgentTaskScope } from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";
import type { AcpClientCallbacks, AcpConnection } from "./connection.js";

/** Web 与独立桌面宿主只替换进程交付，ACP 会话实现保持共用。 */
export interface AcpAgentHandle {
  connection: AcpConnection;
  close(): Promise<void>;
}
export type AcpAgentLauncher = (
  engine: AgentEngine,
  scope: AgentTaskScope,
  callbacks: AcpClientCallbacks,
) => Promise<AcpAgentHandle>;
