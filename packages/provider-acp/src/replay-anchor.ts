import { createHash } from "node:crypto";
import type { AgentTurn } from "@codexly/protocol";

/** 输入使用真正发给 ACP 的内容投影；只落盘摘要，不复制附件正文或携带本地凭据。 */
export function replayFingerprint(turn: AgentTurn, userText?: string): string {
  const items = turn.items.map((item) => {
    const { id: _id, ...body } = item;
    if (item.type !== "message") return body;
    return {
      type: item.type,
      role: item.role,
      text: item.role === "user" && userText !== undefined ? userText : item.text,
    };
  });
  return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}

export interface AcpHistoryEntry {
  turn: AgentTurn;
  replayFingerprint?: string;
}

/** 私有包络与旧裸回合均可读；公开快照始终只返回 turn，不泄漏内部恢复元数据。 */
export function decodeHistoryEntry(line: string): AcpHistoryEntry {
  const parsed = JSON.parse(line) as AgentTurn & {
    version?: number;
    turn?: AgentTurn;
    replayFingerprint?: string;
  };
  if (parsed.version !== 2) return { turn: parsed };
  if (
    !parsed.turn ||
    typeof parsed.replayFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(parsed.replayFingerprint)
  )
    throw new Error("ACP 历史恢复锚点损坏");
  return { turn: parsed.turn, replayFingerprint: parsed.replayFingerprint };
}
