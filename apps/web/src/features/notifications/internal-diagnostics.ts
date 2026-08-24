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
  console.warn("Codexly internal warning", {
    diagnosticCode,
    errorMessage: internalErrorMessage(error),
    ...context,
  });
}
