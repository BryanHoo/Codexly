import sql from "../../protocol/src/acp-scheduled-config-sql.json" with { type: "json" };

function key(input) {
  if (
    !input ||
    !["web", "desktop"].includes(input.source) ||
    typeof input.scheduleId !== "string" ||
    !input.scheduleId.length ||
    input.scheduleId.length > 256
  )
    throw new Error("Invalid ACP scheduled configuration identity");
  return [input.source, input.scheduleId];
}
function revision(input) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
    throw new Error("Invalid ACP scheduled configuration revision");
  return input.expectedRevision;
}
function encode(input) {
  if (
    !["codex", "claude"].includes(input.engine) ||
    !input.values ||
    typeof input.values !== "object" ||
    Array.isArray(input.values)
  )
    throw new Error("Invalid ACP scheduled configuration");
  for (const [name, value] of Object.entries(input.values)) {
    if (
      !name.length ||
      name.length > 256 ||
      !(typeof value === "boolean" || (typeof value === "string" && value.length <= 16384))
    )
      throw new Error("Invalid ACP scheduled configuration value");
  }
  const text = JSON.stringify(input.values);
  if (Buffer.byteLength(text) > 262144)
    throw new Error("ACP scheduled configuration capacity exceeded");
  return text;
}
function record(row) {
  if (!row) return null;
  const value = {
    source: row.source,
    scheduleId: row.schedule_id,
    engine: row.engine,
    revision: row.revision,
    values: JSON.parse(row.values_json),
  };
  // 落盘数据也须校验；损坏配置不能悄悄回退全局默认值。
  key(value);
  encode(value);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new Error("Invalid stored revision");
  return value;
}

/** 独立小表只保存原始 ACP 选项；CAS 与预算由共享 SQL 原子执行，不改旧计划快照。 */
export function createAcpScheduledConfigOperations(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='managed_projects'").get()) return {};
  db.exec(sql.schema);
  const read = db.prepare(sql.read),
    insert = db.prepare(sql.insert),
    update = db.prepare(sql.update),
    remove = db.prepare(sql.delete);
  return {
    "acp.schedule.read": (input) => record(read.get(...key(input))),
    "acp.schedule.set": (input) => {
      const [source, id] = key(input),
        expected = revision(input),
        text = encode(input);
      const row =
        expected === 0
          ? insert.get(source, id, input.engine, text, expected)
          : update.get(input.engine, text, source, id, expected);
      return record(row);
    },
    "acp.schedule.delete": (input) => remove.run(...key(input), revision(input)).changes > 0,
  };
}
