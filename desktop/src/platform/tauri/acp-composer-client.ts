import type { AgentQueuedSubmissionList } from "@codexly/protocol";
type NativeQueue = Awaited<ReturnType<NativeClient["listQueuedSubmissions"]>>;
import type { NativeClient } from "../native-client-contract.js";
import type { MutationOptions } from "../native-client-types.js";
import { buildNativeTaskAttachmentUrl } from "../native-asset-url.js";

type QueueMethods =
  | "listQueuedSubmissions"
  | "addQueuedSubmission"
  | "deleteQueuedSubmission"
  | "startQueuedSubmission"
  | "getTaskAttachmentUrl";
export type AcpComposerQueueClient = Pick<NativeClient, QueueMethods> & {
  moveQueuedSubmission: (
    projectId: string,
    taskId: string,
    id: string,
    offset: -1 | 1,
    options?: MutationOptions,
  ) => Promise<{ moved: boolean }>;
};
export type AcpComposerClient = Pick<
  NativeClient,
  | "previewAcpConfig"
  | "createAcpTask"
  | "getAcpTask"
  | "getAcpSessionState"
  | "setAcpSessionConfig"
  | "startConfiguredAcpPrompt"
  | "interruptAcpTurn"
  | "listAcpQueuedSubmissions"
  | "addAcpQueuedSubmission"
  | "deleteAcpQueuedSubmission"
  | "moveAcpQueuedSubmission"
  | "startAcpQueuedSubmission"
>;

function required<T>(method: T | undefined): T {
  if (method === undefined) throw new Error("ACP 输入框端口不可用");
  return method;
}

function queueView(queue: AgentQueuedSubmissionList): NativeQueue {
  // 编辑中的队列条目由服务端保留，不能被当前发送列表再次执行。
  return {
    data: queue.data.filter(
      (item): item is typeof item & { status: "queued" } => item.status === "queued",
    ),
  };
}

/** 仅组合队列需要的原生端口；保留调用实例，不复制客户端内部状态，也不回退旧引擎。 */
export function createAcpComposerQueueClient(
  client: Partial<AcpComposerClient>,
): AcpComposerQueueClient {
  return {
    listQueuedSubmissions: (...args) => {
      const read = required(client.listAcpQueuedSubmissions?.bind(client));
      return read(...args).then(queueView);
    },
    addQueuedSubmission: async (...args) => {
      const result = await required(client.addAcpQueuedSubmission?.bind(client))(...args);
      if (result.queuedSubmission.status !== "queued")
        throw new Error("ACP 返回了不可发送的队列条目");
      return { ...result, queuedSubmission: { ...result.queuedSubmission, status: "queued" } };
    },
    deleteQueuedSubmission: async (...args) => {
      const result = await required(client.deleteAcpQueuedSubmission?.bind(client))(...args);
      return { deleted: result.deleted };
    },
    moveQueuedSubmission: async (...args) => {
      const result = await required(client.moveAcpQueuedSubmission?.bind(client))(...args);
      return { moved: result.moved };
    },
    startQueuedSubmission: async (...args) => {
      const result = await required(client.startAcpQueuedSubmission?.bind(client))(...args);
      return { taskId: result.taskId, turn: result.turn };
    },
    getTaskAttachmentUrl: (projectId, taskId, attachmentId) =>
      buildNativeTaskAttachmentUrl(projectId, taskId, attachmentId, "acp"),
  };
}
