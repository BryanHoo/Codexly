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

// 应用快照来自现有脱敏导出器；不接收宿主文件路径或额外日志列表。
export const SaveDiagnosticsRequestSchema = Type.Object(
  {
    application: Type.String({ maxLength: 8 * 1024 * 1024 }),
  },
  { additionalProperties: false },
);
export const SaveDiagnosticsResponseSchema = Type.Object(
  {
    downloadId: Type.String({
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    }),
    fileName: Type.String({ pattern: "^codexly-diagnostics-web-[0-9]+\\.zip$" }),
  },
  { additionalProperties: false },
);
export type SaveDiagnosticsRequest = Static<typeof SaveDiagnosticsRequestSchema>;
export type SaveDiagnosticsResponse = Static<typeof SaveDiagnosticsResponseSchema>;
