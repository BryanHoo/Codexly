import type { AgentTurn } from "@codexly/protocol";
import type { ClaudeHistory } from "./history.js";
import { record } from "./sdk-values.js";
import { CLAUDE_HISTORY_PAGE_BYTES } from "./item-history.js";
import { overlayClaudeItems } from "./history-overlay.js";

const PREFIX = "claude-items:";
interface Pending {
  turnId: string;
  before: number | null;
}
interface Cursor {
  task: string;
  pending: Pending[];
  older: string | null;
}
export interface ClaudeHistoryPage {
  turns: AgentTurn[];
  cursor: string | null;
}

function encode(cursor: Cursor): string | null {
  if (!cursor.pending.length) return cursor.older;
  const encoded = PREFIX + Buffer.from(JSON.stringify(cursor)).toString("base64url");
  if (encoded.length > 8192) throw new Error("Claude history cursor exceeds budget");
  return encoded;
}
/** 过程入口仅绑定一个回合，耗尽后直接结束，绝不续读其他回合。 */
export function claudeProcessCursor(task: string, turnId: string): string {
  const cursor = encode({ task, pending: [{ turnId, before: null }], older: null });
  if (!cursor) throw new Error("Claude process cursor is unavailable");
  return cursor;
}
function decode(task: string, cursor?: string): Cursor | undefined {
  if (!cursor?.startsWith(PREFIX)) return undefined;
  if (cursor.length > 8192) throw new Error("Invalid Claude history cursor");
  const value = record(
    JSON.parse(Buffer.from(cursor.slice(PREFIX.length), "base64url").toString("utf8")),
  );
  const rawPending = value["pending"],
    older = value["older"];
  if (
    value["task"] !== task ||
    !Array.isArray(rawPending) ||
    !rawPending.length ||
    rawPending.length > 84 ||
    !(older === null || (typeof older === "string" && /^\d+$/u.test(older)))
  )
    throw new Error("Invalid Claude history cursor");
  const pending = rawPending.map((raw: unknown) => {
    const entry = record(raw),
      turnId = entry["turnId"],
      before = entry["before"];
    if (
      typeof turnId !== "string" ||
      !turnId ||
      !(
        before === null ||
        (typeof before === "number" && Number.isSafeInteger(before) && before >= 0)
      )
    )
      throw new Error("Invalid Claude history cursor");
    return { turnId, before };
  });
  return { task, pending, older };
}

/** 同一顶部游标先补齐当前回合的较早记录，再继续更早回合；不在首屏追读全部历史。 */
export async function paginateClaudeTurns(
  history: ClaudeHistory,
  task: string,
  turns: AgentTurn[],
  older: string | null,
  pending?: Pending[],
  live?: ReadonlyMap<string, AgentTurn>,
  signal?: AbortSignal,
): Promise<ClaudeHistoryPage> {
  // 当前回合页里的旧快照也可能稍后才续读，先准备其索引与恢复状态，避免游标指向不存在的元数据。
  for (const turn of turns) {
    signal?.throwIfAborted();
    await history.prepareItemHistory(task, turn);
  }
  const remaining = pending ?? turns.map((turn) => ({ turnId: turn.id, before: null })).reverse();
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const result: AgentTurn[] = [];
  let budget = CLAUDE_HISTORY_PAGE_BYTES;
  let limit = 100;
  for (let index = 0; index < remaining.length; index++) {
    signal?.throwIfAborted();
    const entry = remaining[index];
    if (!entry) break;
    const turn = byId.get(entry.turnId) ?? (await history.items.turn(task, entry.turnId));
    signal?.throwIfAborted();
    const stored = await history.items.read(task, turn.id, entry.before, budget, limit);
    signal?.throwIfAborted();
    if (!stored) throw new Error("Claude history items are unavailable");
    const page = overlayClaudeItems(
      stored,
      entry.before === null ? live?.get(turn.id)?.items : undefined,
      budget,
      limit,
    );
    const items = page.items;
    const cost = Buffer.byteLength(JSON.stringify({ ...turn, items }));
    if (items.length === 0 && page.before !== null) {
      if (!result.length) throw new Error("Claude history item exceeds page budget");
      return { turns: result, cursor: encode({ task, pending: remaining.slice(index), older }) };
    }
    result.unshift({ ...turn, items });
    budget -= cost;
    limit -= items.length;
    if (page.before !== null) {
      return {
        turns: result,
        cursor: encode({
          task,
          pending: [{ ...entry, before: page.before }, ...remaining.slice(index + 1)],
          older,
        }),
      };
    }
    if ((budget < 1024 || limit === 0) && index + 1 < remaining.length) {
      return {
        turns: result,
        cursor: encode({ task, pending: remaining.slice(index + 1), older }),
      };
    }
  }
  return { turns: result, cursor: older };
}

export async function readClaudeHistoryPage(
  history: ClaudeHistory,
  task: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<ClaudeHistoryPage | undefined> {
  const state = decode(task, cursor);
  return state
    ? paginateClaudeTurns(history, task, [], state.older, state.pending, undefined, signal)
    : undefined;
}
