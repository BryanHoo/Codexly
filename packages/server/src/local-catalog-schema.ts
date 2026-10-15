import schema from "../../protocol/src/local-catalog-schema.json" with { type: "json" };

// Web 与桌面端共用一份领域表定义，适配层不得持久化上游 Thread JSON。
export const LOCAL_CATALOG_SQL = schema.sql;
