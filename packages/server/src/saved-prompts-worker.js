import sql from "../../protocol/src/saved-prompts-sql.json" with { type: "json" };

/** 独立 Worker 中执行共享 SQL，事务锁同时保护 Web 与桌面的逐条更新。 */
export function createSavedPromptOperations(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='managed_projects'").get()) return {};
  db.exec(sql.schema);
  const list = () =>
    db
      .prepare(sql.list)
      .pluck()
      .all()
      .map((row) => JSON.parse(row));
  const encode = (prompt) => {
    if (
      !prompt ||
      typeof prompt.id !== "string" ||
      !prompt.id ||
      prompt.id.length > 200 ||
      typeof prompt.name !== "string" ||
      !prompt.name.trim() ||
      prompt.name.trim().length > 80 ||
      typeof prompt.content !== "string" ||
      !prompt.content.trim() ||
      prompt.content.length > 20000 ||
      (prompt.projectId !== undefined &&
        (typeof prompt.projectId !== "string" || !prompt.projectId.trim()))
    )
      throw new Error("Invalid prompt");
    return JSON.stringify({
      ...prompt,
      name: prompt.name.trim(),
      nameKey: prompt.name.trim().toLowerCase(),
    });
  };
  const mutate = db.transaction((input) => {
    if (input.action === "save") {
      const prompt = encode(input.prompt);
      if (db.prepare(sql.duplicate).get({ 1: prompt })) throw new Error("duplicate");
      db.prepare(sql.save).run({ 1: prompt });
      db.prepare(sql.receipt).run({ 1: prompt });
    } else if (input.action === "import") {
      // 导入回执独立于业务记录保留；重试或其他旧客户端不能复活已删除的提示词。
      if (!Array.isArray(input.prompts) || input.prompts.length > 1000)
        throw new Error("Invalid import");
      for (const entry of input.prompts) {
        const prompt = encode(entry);
        if (db.prepare(sql.receipt).run({ 1: prompt }).changes)
          db.prepare(sql.save).run({ 1: prompt });
      }
    } else if (input.action === "remove") {
      db.prepare(sql.receipt).run({ 1: JSON.stringify(input) });
      db.prepare(sql.remove).run({ 1: JSON.stringify(input) });
    } else if (input.action !== "list") throw new Error("Invalid action");
    return list();
  }).immediate;
  return { "prompts.sync": (input) => (input.action === "list" ? list() : mutate(input)) };
}
