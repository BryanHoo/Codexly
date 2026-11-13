import sql from "../../protocol/src/acp-storage-lock-sql.json" with { type: "json" };
const identifier = (value) => typeof value === "string" && value.length > 0 && value.length <= 256;
function validate(input, keys) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key)) ||
    !identifier(input.key)
  )
    throw new Error("Invalid ACP storage lock");
}
/** 所有权比较和写入在同一 SQLite 事务中完成，迟到回收者不能删除新锁。 */
export function createAcpStorageLockOperations(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='managed_tasks'").get()) return {};
  db.exec(sql.schema);
  const claim = db.transaction((input) => {
    validate(input, ["key", "owner", "pid", "expectedOwner"]);
    if (
      !identifier(input.owner) ||
      !Number.isSafeInteger(input.pid) ||
      input.pid < 1 ||
      input.pid > 2147483647 ||
      !(input.expectedOwner === null || identifier(input.expectedOwner))
    )
      throw new Error("Invalid ACP storage owner");
    return Boolean(
      db
        .prepare(sql.claim)
        .run(input.key, input.owner, input.pid, input.key, input.expectedOwner, input.expectedOwner)
        .changes,
    );
  });
  return {
    "acp.storage.read": (input) => {
      validate(input, ["key"]);
      return db.prepare(sql.read).get(input.key) ?? null;
    },
    "acp.storage.claim": (input) => claim.immediate(input),
    "acp.storage.release": (input) => {
      validate(input, ["key", "owner"]);
      if (!identifier(input.owner)) throw new Error("Invalid ACP storage owner");
      return Boolean(db.prepare(sql.release).run(input.key, input.owner).changes);
    },
  };
}
