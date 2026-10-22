import sql from "../../protocol/src/token-usage-sql.json" with { type: "json" };

/** 仅在 SQLite Worker 执行短事务；不扫描会话，不记录提示词或模型输出。 */
export function createTokenUsageOperations(db) {
  db.exec(sql.schema);
  const seed = db.prepare(sql.seed),
    write = db.prepare(sql.write),
    codex = db.prepare(sql.codex);
  const query = db.prepare(sql.query);
  // 新增分类先建立字段水位；缺失不按零推算，也不把旧消耗误归属当前日期。
  const record = db.transaction((sample) => {
    const encoded = JSON.stringify(sample);
    seed.run({ 1: encoded });
    write.run({ 1: encoded });
  });
  return {
    "usage.record": record,
    "usage.codex": (input) => record(JSON.parse(codex.get({ 1: JSON.stringify(input) }).sample)),
    "usage.query": (input) => {
      const encoded = JSON.stringify(input);
      return {
        days: query.all({ 1: encoded }),
        tasks: input.day ? db.prepare(sql.details).all({ 1: encoded }) : [],
      };
    },
  };
}
