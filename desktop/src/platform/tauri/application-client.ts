import { createAcpCapabilities } from "@codexly/protocol/acp-capabilities";
import type { ReadOptions } from "@/platform/native-client-types.js";
import { TauriSidebarClient } from "./sidebar-client.js";
import { buildNativeTaskAttachmentUrl } from "../native-asset-url.js";

/** 生产应用固定共享 ACP；底层传输的旧协议分支只用于兼容契约回归。 */
export class TauriApplicationClient extends TauriSidebarClient {
  public override getTaskAttachmentUrl(projectId: string, taskId: string, attachmentId: string): string {
    return buildNativeTaskAttachmentUrl(projectId, taskId, attachmentId, "acp");
  }
  public override getCapabilities(options: ReadOptions = {}) {
    options.signal?.throwIfAborted();
    return Promise.resolve(createAcpCapabilities("codex"));
  }
}
