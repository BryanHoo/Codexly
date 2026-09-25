import type { TaskWindowPacket, TaskWindowRow } from "../../protocol/task-window.js";

export type TaskWindowState = Readonly<{
  sequence: number;
  title: string;
  status: string;
  rows: readonly TaskWindowRow[];
  truncated: boolean;
}>;

export const emptyTaskWindowState: TaskWindowState = {
  sequence: 0, title: "", status: "idle", rows: [], truncated: false,
};

export function applyTaskWindowPacket(state: TaskWindowState, packet: TaskWindowPacket): TaskWindowState {
  if (packet.sequence <= state.sequence) return state;
  const rows = new Map(state.rows.map((row) => [row.id, row]));
  for (const update of packet.updates) {
    const previous = rows.get(update.id);
    rows.set(update.id, {
      id: update.id, kind: update.kind,
      text: update.append ? (previous?.text ?? "") + update.text : update.text,
    });
  }
  return {
    sequence: packet.sequence, title: packet.title, status: packet.status,
    // 原生 order 是有界可见集合，同时负责驱逐旧内容。
    rows: packet.order.flatMap((id) => { const row = rows.get(id); return row ? [row] : []; }),
    truncated: packet.truncated,
  };
}
