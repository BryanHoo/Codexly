const validAgentEngine = (value) =>
  value === "codex" ||
  value === "claude" ||
  (typeof value === "string" && /^acp-[a-z0-9][a-z0-9-]{0,95}$/.test(value));
import sql from "../../protocol/src/acp-task-title-sql.json" with { type: "json" };
function identifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}
function validate(input, keys) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key)) ||
    !identifier(input.id) ||
    (keys.includes("token") && !identifier(input.token))
  )
    throw new Error("Invalid ACP title request");
}
export function markAcpTaskTitleManual(db, id) {
  db.prepare(sql.markManual).run(id);
}
/** 触发器只登记新行，不回填旧历史；领取和写入都在 Worker 的持写锁事务中执行。 */
export function createAcpTaskTitleOperations(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='managed_tasks'").get()) return {};
  db.exec(sql.schema);
  db.exec(sql.sourcesSchema);
  const claim = db.transaction((input) => {
    validate(input, ["id", "token", "engine", "projectId"]);
    if (
      !validAgentEngine(input.engine) ||
      !(input.projectId === null || identifier(input.projectId))
    )
      throw new Error("Invalid ACP title scope");
    return Boolean(
      db.prepare(sql.claim).run(input.token, input.id, input.engine, input.projectId).changes,
    );
  });
  const finish = db.transaction((input) => {
    validate(input, ["id", "token", "title"]);
    if (!(
      input.title === null ||
      (typeof input.title === "string" &&
        input.title.trim() &&
        Array.from(input.title).length <= 36)
    ))
      throw new Error("Invalid ACP title");
    if (!db.prepare(sql.owned).get(input.id, input.token)) return null;
    db.prepare(sql.finish).run(input.id, input.token);
    if (input.title === null) return null;
    if (!db.prepare(sql.write).run(input.title, input.id).changes) return null;
    db.prepare(sql.saveGenerated).run(input.id, input.title);
    return input.title;
  });
  const agent = db.transaction((input) => {
    validate(input, ["id", "engine", "projectId", "sessionId", "title"]);
    if (
      !validAgentEngine(input.engine) ||
      !(input.projectId === null || identifier(input.projectId)) ||
      typeof input.sessionId !== "string" ||
      !input.sessionId ||
      Buffer.byteLength(input.sessionId) > 1024 ||
      !(
        input.title === null ||
        (typeof input.title === "string" && input.title.trim() && input.title.length <= 512)
      )
    )
      throw new Error("Invalid ACP agent title");
    // 来源记录和公开目录标题共用一个事务，目录列表与任务快照读取同一个有效名称。
    if (!db.prepare(sql.saveAgent).run(input).changes) return null;
    return db.prepare(sql.publishAgent).get(input.id)?.title ?? null;
  });
  return {
    "acp.title.claim": (input) => claim.immediate(input),
    "acp.title.finish": (input) => finish.immediate(input),
    "acp.title.agent": (input) => agent.immediate(input),
  };
}
