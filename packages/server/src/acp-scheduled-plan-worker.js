import stateSql from "../../protocol/src/acp-plan-state-sql.json" with { type: "json" };
import { Value } from "@sinclair/typebox/value";
import schema from "../../protocol/src/acp-scheduled-plan-schema.js";
import sql from "../../protocol/src/acp-scheduled-plan-sql.json" with { type: "json" };

function key(p) {
  if (
    !p ||
    !["web", "desktop"].includes(p.source) ||
    typeof p.scheduleId !== "string" ||
    !p.scheduleId.length ||
    p.scheduleId.length > 256
  )
    throw new Error("Invalid ACP plan identity");
  return [p.source, p.scheduleId];
}
function revision(p) {
  if (!Number.isSafeInteger(p.expectedRevision) || p.expectedRevision < 0)
    throw new Error("Invalid ACP plan revision");
  return p.expectedRevision;
}
function encode(definition) {
  if (!Value.Check(schema, definition)) throw new Error("Invalid ACP plan definition");
  const text = JSON.stringify(definition);
  if (Buffer.byteLength(text) > 524288) throw new Error("ACP plan capacity exceeded");
  return text;
}
function record(row) {
  if (!row) return null;
  const definition = JSON.parse(row.definition_json);
  encode(definition);
  return { source: row.source, scheduleId: row.schedule_id, definition, revision: row.revision };
}
/** 新计划原始定义独立落盘；项目身份、CAS 和容量由同一条 SQL 原子保护。 */
export function createAcpScheduledPlanOperations(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='managed_projects'").get()) return {};
  db.exec(sql.schema);
  db.exec(stateSql.schema);
  const read = db.prepare(sql.read),
    insert = db.prepare(sql.insert),
    update = db.prepare(sql.update),
    remove = db.prepare(sql.delete);
  return {
    "acp.plan.read": (p) => record(read.get(...key(p))),
    "acp.plan.set": (p) => {
      const [source, id] = key(p),
        expected = revision(p),
        text = encode(p.definition);
      return record(
        expected === 0
          ? insert.get(source, id, text)
          : update.get(text, source, id, expected, text),
      );
    },
    "acp.plan.delete": (p) => remove.run(...key(p), revision(p)).changes > 0,
  };
}
