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
    !identifier(input.token)
  )
    throw new Error("Invalid ACP title request");
}
/** 触发器只登记新行，不回填旧历史；领取和写入都在 Worker 的持写锁事务中执行。 */
export function createAcpTaskTitleOperations(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='managed_tasks'").get()) return {};
  db.exec(sql.schema);
  const claim = db.transaction((input) => {
    validate(input, ["id", "token", "engine", "projectId"]);
    if (
      !["codex", "claude"].includes(input.engine) ||
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
    return db.prepare(sql.write).run(input.title, input.id).changes ? input.title : null;
  });
  return {
    "acp.title.claim": (input) => claim.immediate(input),
    "acp.title.finish": (input) => finish.immediate(input),
  };
}
