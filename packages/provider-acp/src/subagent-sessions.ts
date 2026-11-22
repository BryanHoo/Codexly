import { acpSubagentItemPrefix, type AgentItem } from "@codexly/protocol";
import type { SubagentUpdate } from "@agentclientprotocol/sdk/unstable";

export type AcpSubagentItem = Extract<AgentItem, { type: "acp_subagent" }>;

interface Association {
  rootSessionId: string;
  item: AcpSubagentItem;
}

/** 每条连接只接受已知父会话的公告。后续补丁不能改写归属或形成环。 */
export class AcpSubagentSessions {
  readonly #children = new Map<string, Association>();

  get(sessionId: string) {
    return this.#children.get(sessionId);
  }

  announce(parentSessionId: string, rootSessionId: string, update: SubagentUpdate) {
    const { sessionId } = update;
    if (!sessionId || sessionId.length > 1024 || !sessionId.isWellFormed()) return;
    const previous = this.#children.get(sessionId);
    if (previous && previous.item.parentSessionId !== parentSessionId) return;
    if (!previous && this.#children.size >= 512) return;
    const title =
      update.title === undefined ? previous?.item.title : update.title?.trim().slice(0, 512);
    const description =
      update.description === undefined
        ? previous?.item.description
        : update.description?.trim().slice(0, 2048);
    const state = update.state === undefined ? previous?.item.state : update.state?.state;
    const item: AcpSubagentItem = {
      id: acpSubagentItemPrefix(sessionId),
      type: "acp_subagent",
      sessionId,
      parentSessionId,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(state ? { state: state.slice(0, 64) } : {}),
    };
    this.#children.set(sessionId, { rootSessionId, item });
    return item;
  }

  hasChildren(rootSessionId: string) {
    for (const child of this.#children.values())
      if (child.rootSessionId === rootSessionId) return true;
    return false;
  }

  hasWork(rootSessionId?: string) {
    for (const child of this.#children.values()) {
      if (rootSessionId !== undefined && child.rootSessionId !== rootSessionId) continue;
      if (child.item.state === "running" || child.item.state === "requires_action") return true;
    }
    return false;
  }

  forget(rootSessionId: string) {
    for (const [id, child] of this.#children) {
      if (child.rootSessionId === rootSessionId) this.#children.delete(id);
    }
  }

  clear() {
    this.#children.clear();
  }
}
