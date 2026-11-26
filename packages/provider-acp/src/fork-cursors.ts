import type { CursorAnchor, CursorUpdate } from "@agentclientprotocol/sdk/unstable";

interface ForkCursor {
  anchor: CursorAnchor;
  fork: boolean;
}

export class AcpForkCursors {
  readonly #sessions = new Map<string, Map<string, ForkCursor>>();

  update(sessionId: string, update: CursorUpdate): void {
    let session = this.#sessions.get(sessionId);
    if (!session) {
      if (!update.anchor || this.#sessions.size >= 64) return;
      session = new Map<string, ForkCursor>();
      this.#sessions.set(sessionId, session);
    }
    const previous = session.get(update.cursorId);
    if (previous) {
      if (Object.hasOwn(update, "capabilities")) previous.fork = !!update.capabilities?.fork;
    } else if (update.anchor) {
      // 游标属于 Agent 和当前会话。限制每个会话的驻留数量，旧游标可降级为聊天接续。
      if (session.size >= 4096) {
        const oldest = session.keys().next().value;
        if (oldest !== undefined) session.delete(oldest);
      }
      session.set(update.cursorId, {
        anchor: update.anchor,
        fork: !!update.capabilities?.fork,
      });
    }
  }

  after(sessionId: string, type: "user_message" | "agent_message", messageId: string) {
    for (const [id, { anchor, fork }] of this.#sessions.get(sessionId) ?? []) {
      if (
        fork &&
        anchor.type === type &&
        "messageId" in anchor &&
        anchor.messageId === messageId &&
        anchor.position === "after"
      )
        return id;
    }
    return undefined;
  }

  delete(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }
}
