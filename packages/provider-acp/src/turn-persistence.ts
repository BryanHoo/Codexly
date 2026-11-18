import { setTimeout } from "node:timers/promises";
import type { AgentTurn } from "@codexly/protocol";

/** 只重试可能由短暂存储竞争引起的错误，不重发 ACP prompt。 */
async function retryAcpHistoryWrite(write: () => Promise<void>): Promise<void> {
  for (const delay of [25, 100, 0]) {
    try {
      await write();
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
      if (
        !delay ||
        !code ||
        !["EAGAIN", "EBUSY", "EINTR", "EMFILE", "ENFILE", "ETIMEDOUT"].includes(code)
      )
        throw error;
      await setTimeout(delay);
    }
  }
}

function acpHistoryWriteMessage(error: unknown): string {
  switch ((error as NodeJS.ErrnoException | null | undefined)?.code) {
    case "ENOSPC":
    case "EDQUOT":
      return "存储空间不足，暂不能保存对话。请释放磁盘空间后继续。";
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return "对话存储不可写。请检查应用数据目录的权限后继续。";
    default:
      return "暂不能保存对话。请检查应用数据目录是否可写后继续。";
  }
}

/** 附件只组装一次；历史已提交但目录更新失败时，后续只补写目录。 */
export function prepareAcpHistoryCommit(
  materialize: () => Promise<AgentTurn>,
  append: (turn: AgentTurn) => Promise<void>,
  idle: () => Promise<void>,
): () => Promise<AgentTurn> {
  let stored: AgentTurn | undefined;
  let committed = false;
  return async () => {
    try {
      const turn = (stored ??= await materialize());
      if (!committed) {
        await retryAcpHistoryWrite(() => append(turn));
        committed = true;
      }
      await retryAcpHistoryWrite(idle);
      return turn;
    } catch (error) {
      throw new Error(acpHistoryWriteMessage(error), { cause: error });
    }
  };
}
