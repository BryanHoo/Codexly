import { Type, type Static } from "@sinclair/typebox";

// 诊断快照只承载脱敏后的日志投影，不接受宿主路径或任意文件读取参数。
export const DiagnosticsResponseSchema = Type.Object(
  {
    version: Type.Literal(1),
    exportedAt: Type.String(),
    runtime: Type.Object(
      {
        nodeVersion: Type.String(),
        platform: Type.String(),
        arch: Type.String(),
        uptimeSeconds: Type.Number({ minimum: 0 }),
        memoryBytes: Type.Number({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    logs: Type.Array(Type.String({ maxLength: 16_384 }), { maxItems: 2_000 }),
    droppedEntries: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type DiagnosticsResponse = Static<typeof DiagnosticsResponseSchema>;
