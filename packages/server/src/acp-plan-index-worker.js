import { Value } from "@sinclair/typebox/value";
import definitionSchema from "../../protocol/src/acp-scheduled-plan-schema.js";
import sql from "../../protocol/src/acp-plan-index-sql.json" with { type: "json" };

function metadata(row) {
  const item = JSON.parse(row.metadata_json);
  // 只校验精简投影，不从数据库传回提示词与原始配置；损坏索引不可推断为默认值。
  if (
    !Value.Check(definitionSchema, {
      ...item,
      prompt: { type: "prompt", text: "_", attachments: [], skills: [] },
      values: {},
    })
  )
    throw new Error("Invalid ACP plan index");
  return {
    ...item,
    source: row.source,
    scheduleId: row.schedule_id,
    revision: row.revision,
    stateRevision: row.state_revision,
    scheduledRevision: row.scheduled_revision,
    nextRunAt: row.next_run_at,
  };
}

export function createAcpPlanIndexOperations(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='acp_plan_index'").get()) return {};
  const list = db.prepare(sql.list),
    due = db.prepare(sql.due);
  return {
    "acp.plan.list": (p) => {
      validate(p);
      const after = p.after === undefined ? "" : p.after;
      if (typeof after !== "string" || after.length > 256)
        throw new Error("Invalid ACP plan cursor");
      const rows = list.all(p.source, after, p.limit + 1);
      const data = rows.slice(0, p.limit).map(metadata);
      return { data, nextCursor: rows.length > p.limit ? data.at(-1).scheduleId : null };
    },
    "acp.plan.due": (p) => {
      validate(p);
      if (!Number.isSafeInteger(p.now)) throw new Error("Invalid ACP plan clock");
      const after = p.after;
      if (
        after !== undefined &&
        (!Number.isSafeInteger(after.nextRunAt) ||
          typeof after.scheduleId !== "string" ||
          !after.scheduleId.length ||
          after.scheduleId.length > 256)
      )
        throw new Error("Invalid ACP due cursor");
      return due
        .all(
          p.source,
          p.now,
          after?.nextRunAt ?? null,
          after?.nextRunAt ?? null,
          after?.nextRunAt ?? null,
          after?.scheduleId ?? "",
          p.limit,
        )
        .map(metadata);
    },
  };
}
function validate(p) {
  if (
    !["web", "desktop"].includes(p?.source) ||
    !Number.isInteger(p.limit) ||
    p.limit < 1 ||
    p.limit > 100
  )
    throw new Error("Invalid ACP plan index query");
}
