import type * as acp from "@agentclientprotocol/sdk/unstable";
import type { AcpSessionMetadata } from "./session-metadata.js";

export interface AcpClientCallbacks {
  /** 更新直接增量交付；上层按 sessionId 路由，禁止在这里重建整个历史。 */
  onUpdate?(notification: acp.SessionNotification, historical: boolean): void | Promise<void>;
  supportsSubagents?: boolean;
  supportsRequestElicitation?: boolean;
  subagentRoot?(sessionId: string): string | undefined;
  resetSubagentWork?(rootSessionId: string): void;
  onSessionState?(sessionId: string, state: AcpSessionMetadata): void | Promise<void>;
  requestElicitation?(
    request: acp.CreateElicitationRequest,
    signal: AbortSignal,
  ): Promise<acp.CreateElicitationResponse>;
  onElicitationComplete?(id: string): void;
  requestPermission?(
    request: acp.RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<acp.RequestPermissionResponse>;
}
