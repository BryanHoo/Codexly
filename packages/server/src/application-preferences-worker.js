import sql from "../../protocol/src/application-preferences-sql.json" with { type: "json" };

import { Value } from "@sinclair/typebox/value";
import schema from "../../protocol/src/application-preferences-schema.js";
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function validate(value, partial = false) {
  if (
    !object(value) ||
    !Object.keys(value).length ||
    (!partial && !Value.Check(schema, value)) ||
    (partial &&
      Object.entries(value).some(
        ([k, v]) => !Object.hasOwn(schema.properties, k) || !Value.Check(schema.properties[k], v),
      )) ||
    (partial && Object.hasOwn(value, "defaultAgent") !== Object.hasOwn(value, "defaultModel"))
  )
    throw new Error("Invalid application preferences");
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 262144)
    throw new Error("Application preferences capacity exceeded");
  return text;
}
/** 独立私有快照；同步操作仅在 SQLite Worker 内执行，不触碰旧设置表。 */
export function createApplicationPreferencesOperations(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='managed_projects'").get()) return {};
  db.exec(sql.schema);
  const read = () => {
    const row = db.prepare(sql.read).get();
    if (!row) return null;
    const value = JSON.parse(row.settings_json);
    validate(value);
    return value;
  };
  const patch = db.transaction(({ baseline, changes }) => {
    validate(changes, true);
    const current = read();
    if (!current) validate(baseline);
    const next = { ...(current ?? baseline), ...changes };
    db.prepare(sql.write).run(validate(next));
    return next;
  });
  return {
    "app.preferences.read": read,
    // 先取得写锁再读，避免 Web / Native 或多个 Worker 同时首次保存时丢失字段。
    "app.preferences.patch": (input) => patch.immediate(input),
  };
}
