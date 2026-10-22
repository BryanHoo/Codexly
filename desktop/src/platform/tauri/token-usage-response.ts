import { TokenUsageResponseSchema, type TokenUsageResponse } from "@codexly/protocol";
import { Value } from "@sinclair/typebox/value";

/** 校验器跟随统计面板按需加载，避免把用量 Schema 放入聊天首屏依赖。 */
export function parseTokenUsageResponse(value: unknown): TokenUsageResponse {
  if (!Value.Check(TokenUsageResponseSchema, value)) throw new Error("Invalid usage response");
  return value;
}
