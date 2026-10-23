/** 两端共用异常投影；录制与脱敏由各平台适配器负责，不读取应用状态。 */
export type FrontendErrorDiagnostic = Readonly<{
  context: Record<string, boolean | number | string | null>;
  errorMessage: string | null;
  event: string;
  level: "error";
  stack: string | null;
}>;
export type DiagnosticRecorder = (input: FrontendErrorDiagnostic) => void;

export function createReactDiagnosticHandlers(record: DiagnosticRecorder) {
  return {
    onCaughtError(error: unknown, info: { componentStack?: string | null | undefined }) {
      recordApplicationError(record, "react_error_caught", error, info.componentStack);
    },
    onRecoverableError(error: unknown, info: { componentStack?: string | null | undefined }) {
      recordApplicationError(record, "react_error_recoverable", error, info.componentStack);
    },
    onUncaughtError(error: unknown, info: { componentStack?: string | null | undefined }) {
      recordApplicationError(record, "react_error_uncaught", error, info.componentStack);
    },
  };
}

export function installGlobalDiagnostics(target: Window, record: DiagnosticRecorder): () => void {
  const onError = (event: ErrorEvent) => {
    recordApplicationError(record, "window_error", event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    recordApplicationError(record, "unhandled_promise_rejection", event.reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

export function recordApplicationError(
  record: DiagnosticRecorder,
  event: string,
  error: unknown,
  componentStack?: string | null,
): void {
  // 诊断失败不可产生新的未处理异常，避免错误采集递归影响应用。
  try {
    const message =
      error instanceof Error
        ? error.message || error.name
        : typeof error === "string" && error.trim()
          ? error
          : "Unknown application error";
    const stack = error instanceof Error ? (error.stack ?? null) : null;
    record({
      context: {},
      errorMessage: message,
      event,
      level: "error",
      stack: componentStack ?? stack,
    });
  } catch {
    // 原始异常/录制器异常都不阻断主流程。
  }
}
