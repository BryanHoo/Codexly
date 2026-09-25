type InternalDiagnosticValue = boolean | number | string | null | undefined;

export type InternalDiagnosticContext = Readonly<Record<string, InternalDiagnosticValue>>;

function internalErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Unknown internal error";
}

export function recordInternalWarning(
  diagnosticCode: string,
  error: unknown,
  context: InternalDiagnosticContext = {},
): void {
  // 后台循环只写安全结构化诊断，禁止接入用户动作 toast。
  recordFrontendDiagnostic({
    context: Object.fromEntries(
      Object.entries(context).filter((entry): entry is [string, Exclude<InternalDiagnosticValue, undefined>] => entry[1] !== undefined),
    ),
    errorMessage: internalErrorMessage(error),
    event: diagnosticCode,
    level: "warn",
    stack: error instanceof Error ? (error.stack ?? null) : null,
  });
  if (import.meta.env.DEV) console.warn("CodeAgent internal warning", { diagnosticCode, ...context });
}
import { recordFrontendDiagnostic } from "../../platform/tauri/diagnostics.js";
