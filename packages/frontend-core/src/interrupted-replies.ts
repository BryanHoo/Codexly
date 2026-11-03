interface ReplyItem {
  id: string;
  type: string;
  role?: string;
  text?: string;
  phase?: string;
}
interface ReplyTurn<Item extends ReplyItem = ReplyItem> {
  id: string;
  status: string;
  items: Item[];
}
export interface InterruptedReplyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function browserInterruptedReplyStorage(): InterruptedReplyStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** 仅为原生历史尚未确认的中断正文补充恢复记录；不持久化整个会话或逐 Token 写盘。 */
export function createInterruptedReplyRecovery(
  identity: { projectId: string; taskId: string },
  storage?: InterruptedReplyStorage,
) {
  const key = (turnId: string) =>
    `codeagent.interrupted-reply.v1:${JSON.stringify([identity.projectId, identity.taskId, turnId])}`;
  function read(turnId: string): ReplyItem[] {
    try {
      const raw = storage?.getItem(key(turnId));
      if (!raw) return [];
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value)) return [];
      return value.filter(
        (item: unknown): item is ReplyItem =>
          typeof item === "object" &&
          item !== null &&
          "id" in item &&
          "type" in item &&
          "role" in item &&
          "text" in item &&
          typeof item.id === "string" &&
          item.type === "message" &&
          item.role === "assistant" &&
          typeof item.text === "string" &&
          (!("phase" in item) ||
            item.phase === undefined ||
            item.phase === "final_answer" ||
            item.phase === "partial_answer"),
      );
    } catch {
      return [];
    }
  }
  return {
    save(turn: ReplyTurn): void {
      if (turn.status !== "interrupted") return;
      const items = turn.items.filter(
        (item) =>
          item.type === "message" &&
          item.role === "assistant" &&
          item.phase !== "commentary" &&
          Boolean(item.text),
      );
      if (items.length === 0) return;
      // 每个回合独立保存，避免为新增中断答案重新序列化历史任务。
      const retained = new Map(read(turn.id).map((item) => [item.id, item]));
      for (const item of items) {
        const previous = retained.get(item.id);
        if ((previous?.text?.length ?? 0) <= (item.text?.length ?? 0))
          retained.set(item.id, {
            id: item.id,
            type: "message",
            role: "assistant",
            text: item.text ?? "",
            ...(item.phase === undefined ? {} : { phase: item.phase }),
          });
      }
      try {
        storage?.setItem(key(turn.id), JSON.stringify([...retained.values()]));
      } catch (error) {
        console.warn("无法保存中断前的结果正文", error);
      }
    },
    restore<Turn extends ReplyTurn>(turns: Turn[]): Turn[] {
      return turns.map((turn) => {
        if (turn.status !== "interrupted") return turn;
        const saved = read(turn.id);
        if (saved.length === 0) return turn;
        const byId = new Map(saved.map((item) => [item.id, item]));
        // 同 ID 的非空权威正文优先；空占位不能撤销已展示的中断正文。
        const items = turn.items.map((item) => {
          const retained = byId.get(item.id);
          byId.delete(item.id);
          return retained !== undefined &&
            item.type === "message" &&
            item.role === "assistant" &&
            !item.text
            ? { ...item, ...retained }
            : item;
        });
        return { ...turn, items: [...items, ...byId.values()] };
      });
    },
  };
}
