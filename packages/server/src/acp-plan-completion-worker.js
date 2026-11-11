import sql from "../../protocol/src/acp-plan-completion-sql.json" with { type: "json" };

function text(value, max, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > max || (!nullable && !value.length))
    throw new Error("Invalid ACP completion identity");
  return value;
}
function key(p) {
  if (!["web", "desktop"].includes(p?.source)) throw new Error("Invalid ACP completion source");
  return [p.source, text(p.scheduleId, 256), text(p.runId, 256)];
}
function outcome(p) {
  const value = {
    source: p.source,
    scheduleId: p.scheduleId,
    runId: p.runId,
    projectId: text(p.projectId, 128),
    status: p.status,
    taskId: p.taskId === null ? null : text(p.taskId, 256),
    error: text(p.error, 2048, true),
  };
  if (!(
    (value.status === "started" && value.taskId && value.error === null) ||
    (value.status === "failed" && value.error !== null)
  ))
    throw new Error("Invalid ACP completion outcome");
  return value;
}

/** 已确认结果先落意图，再清理缓存；原子终态触发器会核对并回收意图。 */
export function createAcpPlanCompletionOperations(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='acp_plan_runs'").get()) return {};
  db.exec(sql.schema);
  const read = (p) => {
    const row = db.prepare(sql.read).get(...key(p));
    return row ? outcome(JSON.parse(row.result)) : null;
  };
  const put = db.transaction((p) => {
    const k = key(p),
      value = outcome(p);
    db.prepare(sql.put).run(
      value.projectId,
      value.status,
      value.taskId,
      value.error,
      ...k,
      value.projectId,
    );
    const previous = read(p);
    return previous && JSON.stringify(previous) === JSON.stringify(value) ? previous : null;
  });
  return { "acp.plan.completion.read": read, "acp.plan.completion.put": (p) => put.immediate(p) };
}
