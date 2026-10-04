import { Type, type Static } from "@sinclair/typebox";

// 只确认已提交后台维护请求；Codex 不提供完成进度或实际节省空间。
export const HistoryCompressionResultSchema = Type.Object(
  { status: Type.Literal("scheduled") },
  { additionalProperties: false },
);
export type HistoryCompressionResult = Static<typeof HistoryCompressionResultSchema>;
