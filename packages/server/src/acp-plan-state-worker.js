import { Value } from "@sinclair/typebox/value";
import definitionSchema from "../../protocol/src/acp-scheduled-plan-schema.js";
import sql from "../../protocol/src/acp-plan-state-sql.json" with { type: "json" };

function integer(n, minimum = 0) {
  if (!Number.isSafeInteger(n) || n < minimum) throw new Error("Invalid ACP plan counter");
  return n;
}
function text(value, maximum, nullable = false) {
  if (nullable && value === null) return value;
  if (typeof value !== "string" || value.length > maximum || (!nullable && !value.length))
    throw new Error("Invalid ACP plan text");
  return value;
}
function key(p) {
  if (!["web", "desktop"].includes(p?.source)) throw new Error("Invalid ACP plan source");
  return [p.source, text(p.scheduleId, 256)];
}
const time = (value) => (value === null ? null : integer(value, -Number.MAX_SAFE_INTEGER));
const result = (row) => {
  if (!row) return null;
  const value = JSON.parse(row.result);
  // 落盘定义同样校验；损坏快照必须使领取事务整体回滚，不能带入执行器。
  if (
    value.definition !== undefined &&
    value.definition !== null &&
    !Value.Check(definitionSchema, value.definition)
  )
    throw new Error("Invalid stored ACP plan definition");
  return value;
};

/** 领取事务同时推进游标并保存执行快照；未确认结果没有超时自动解锁。 */
export function createAcpPlanStateOperations(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='acp_scheduled_plans'").get()) return {};
  db.exec(sql.schema);
  const read = (name, values) => result(db.prepare(sql[name]).get(...values));
  const claim = db.transaction((p) => {
    const [source, id] = key(p),
      runId = text(p.runId, 256);
    const now = integer(p.now, -Number.MAX_SAFE_INTEGER),
      next = time(p.nextRunAt);
    if (next !== null && next <= now) throw new Error("Next ACP plan time must advance");
    const state = read("claimCursor", [
      next,
      source,
      id,
      integer(p.expectedStateRevision, 1),
      integer(p.expectedRevision, 1),
      now,
    ]);
    if (!state) return null;
    db.prepare(sql.prune).run(source, id);
    // 唯一身份冲突等任何错误都回滚游标和裁剪，不能消耗一轮执行却没有运行记录。
    db.prepare(sql.claimInsert).run(runId, now, source, id);
    return read("readRun", [source, id, runId]);
  });
  return {
    "acp.plan.readState": (p) => read("readState", key(p)),
    "acp.plan.readRun": (p) => read("readRun", [...key(p), text(p.runId, 256)]),
    "acp.plan.arm": (p) => {
      const [source, id] = key(p),
        revision = integer(p.expectedRevision, 1),
        stateRevision = integer(p.expectedStateRevision),
        next = time(p.nextRunAt);
      return stateRevision === 0
        ? read("armInsert", [next, source, id, revision])
        : read("armUpdate", [revision, next, source, id, stateRevision, revision]);
    },
    "acp.plan.claim": (p) => claim.immediate(p),
    "acp.plan.finish": (p) => {
      const identity = key(p),
        runId = text(p.runId, 256);
      if (
        !["claimed", "unknown"].includes(p.expectedStatus) ||
        !["unknown", "started", "failed"].includes(p.status)
      )
        throw new Error("Invalid ACP plan phase");
      const taskId = p.taskId === null ? null : text(p.taskId, 256);
      const error = text(p.error, 2048, true);
      if ((p.status === "started" && taskId === null) || (p.status !== "started" && error === null))
        throw new Error("Missing ACP plan outcome");
      return read("finish", [
        p.status,
        taskId,
        error,
        p.status,
        ...identity,
        runId,
        p.expectedStatus,
      ]);
    },
  };
}
