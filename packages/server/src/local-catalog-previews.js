import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import schema from "../../protocol/src/local-catalog-schema.json" with { type: "json" };

/** 预览只保存首个非空输入行，限制目录载荷，不把后续消息或完整正文放入列表。 */
export function taskPreview(text) {
  return Array.from(text.trim().slice(0, 2048).split(/\r?\n/u)[0].trim()).slice(0, 1024).join("");
}

export const TASK_PREVIEW_SELECT =
  "SELECT managed_tasks.*, (SELECT preview FROM managed_task_previews WHERE task_id=managed_tasks.id) AS preview FROM visible_managed_tasks AS managed_tasks";

export function writeTaskPreview(db, id, preview) {
  const bounded = taskPreview(preview);
  if (!bounded) return 0;
  // 插入与归属检查在一条 SQL 内完成：删除任务不会复活，后续输入不会改写首条预览。
  return db
    .prepare(
      `INSERT INTO managed_task_previews (task_id,preview)
    SELECT id,? FROM managed_tasks WHERE id=? ON CONFLICT(task_id) DO NOTHING`,
    )
    .run(bounded, id).changes;
}

/** 仅按既有 provider/sessionId 只读补齐预览，不导入任务或覆盖应用管理字段。 */
export function recoverTaskPreviews(db, databasePath) {
  const missing = db
    .prepare(
      `${TASK_PREVIEW_SELECT}
    WHERE provider='codex' AND title='' AND session_id IS NOT NULL AND preview IS NULL`,
    )
    .all();
  if (!missing.length) return 0;
  let source;
  let previews;
  try {
    source = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 100 });
    const read = source.prepare("SELECT substr(preview,1,1024) AS preview FROM threads WHERE id=?");
    previews = missing.flatMap((task) => {
      const preview = read.get(task.session_id)?.preview;
      return typeof preview === "string" && taskPreview(preview) ? [[task.id, preview]] : [];
    });
  } catch {
    // 引擎尚未安装、数据库被占用或版本不兼容时，仍允许离线管理；下次启动重试。
    return 0;
  } finally {
    source?.close();
  }
  return db.transaction(() => {
    let written = 0;
    for (const [id, preview] of previews) written += writeTaskPreview(db, id, preview);
    return written;
  })();
}

export function defaultCodexStateDatabase() {
  return join(
    process.env.CODEX_SQLITE_HOME || process.env.CODEX_HOME || join(homedir(), ".codex"),
    "state_5.sqlite",
  );
}

export function recoverBackgroundSessions(db, databasePath) {
  let source;
  let sessions;
  try {
    // 仅查看 Codex 的首条输入和来源。使用两端共用的旧版生成请求特征，不分析聊天标题。
    source = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 100 });
    sessions = source.prepare(schema.acpLegacyBackgroundSql).pluck().all();
  } catch {
    // 离线或索引不兼容时维持目录可用，下次打开再尝试。
    return;
  } finally {
    source?.close();
  }
  if (!sessions.length) return;
  const mark = db.prepare(schema.acpMarkBackgroundSql);
  db.transaction(() => {
    for (const id of sessions) mark.run("codex", id);
  })();
}
