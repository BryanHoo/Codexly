import { Type, type Static } from "@sinclair/typebox";

export const DiagnosticLevelSchema = Type.Union([
  Type.Literal("debug"),
  Type.Literal("error"),
  Type.Literal("info"),
  Type.Literal("warn"),
]);

const DiagnosticContextValueSchema = Type.Union([
  Type.Boolean(),
  Type.Null(),
  Type.Number(),
  Type.String(),
]);

export const FrontendDiagnosticInputSchema = Type.Object({
  context: Type.Record(Type.String(), DiagnosticContextValueSchema),
  errorMessage: Type.Union([Type.Null(), Type.String()]),
  event: Type.String(),
  level: DiagnosticLevelSchema,
  stack: Type.Union([Type.Null(), Type.String()]),
});

export const ExportDiagnosticsResponseSchema = Type.Union([
  Type.Object({ status: Type.Literal("cancelled") }),
  Type.Object({ fileName: Type.String(), status: Type.Literal("saved") }),
]);

export type DiagnosticLevel = Static<typeof DiagnosticLevelSchema>;
export type FrontendDiagnosticInput = Static<typeof FrontendDiagnosticInputSchema>;
export type ExportDiagnosticsResponse = Static<typeof ExportDiagnosticsResponseSchema>;
