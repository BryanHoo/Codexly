import type { AgentEvent } from "./agent-event.js";
import type { AgentItem, AgentTurn, PendingRequest } from "./project.js";

type ReasoningPayload = Extract<AgentEvent, { type: "reasoning.delta" }>["payload"];
type RebindEvent<Event, Item, Turn, Request, Reasoning> = Event extends {
  type: "turn.started" | "turn.completed";
}
  ? Omit<Event, "payload"> & { payload: { turn: Turn & { items: Item[] } } }
  : Event extends { type: "file_change.updated"; payload: infer Payload }
    ? Omit<Event, "payload"> & {
        payload: Omit<Payload, "changes"> & {
          changes: Item extends { type: "file_change"; changes: infer Changes } ? Changes : never;
        };
      }
    : Event extends { type: "item.started" | "item.completed" }
      ? Omit<Event, "payload"> & { payload: { item: Item } }
      : Event extends {
            type:
              "pending_request.created" | "pending_request.resolved" | "pending_request.expired";
            payload: { request: { status: infer Status } };
          }
        ? Omit<Event, "payload"> & { payload: { request: Request & { status: Status } } }
        : Event extends { type: "reasoning.delta" }
          ? Omit<Event, "payload"> & { payload: Reasoning }
          : Event;

/**
 * 两端消费同一事件判别联合，只替换确有平台差异的实体载荷。
 * 从公开 AgentEvent 派生，新增公共事件会自动进入消费模型；不另建线缆协议或复制运行时数据。
 * 桌面可以保留公开推理摘要、终端审批及附件扩展，Web 保留完整的字段区分。
 */
export type TaskEventModel<
  Item = AgentItem,
  Turn = Omit<AgentTurn, "items">,
  Request = PendingRequest,
  Reasoning = ReasoningPayload,
> = RebindEvent<AgentEvent, Item, Turn, Request, Reasoning>;
