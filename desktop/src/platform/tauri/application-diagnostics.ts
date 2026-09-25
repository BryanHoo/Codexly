import type { RootOptions } from "react-dom/client";

import type { FrontendDiagnosticInput } from "@/protocol/index.js";

import { recordFrontendDiagnostic } from "./diagnostics.js";

type DiagnosticRecorder = (input: FrontendDiagnosticInput) => void;

export function createReactDiagnosticHandlers(
  record: DiagnosticRecorder = recordFrontendDiagnostic,
): RootOptions {
  return {
    onCaughtError(error, errorInfo) {
      recordError(record, "react_error_caught", error, errorInfo.componentStack);
    },
    onRecoverableError(error, errorInfo) {
      recordError(record, "react_error_recoverable", error, errorInfo.componentStack);
    },
    onUncaughtError(error, errorInfo) {
      recordError(record, "react_error_uncaught", error, errorInfo.componentStack);
    },
  };
}

export function installGlobalDiagnostics(
  target: Window = window,
  record: DiagnosticRecorder = recordFrontendDiagnostic,
): () => void {
  const onError = (event: ErrorEvent) => {
    recordError(record, "window_error", event.error ?? event.message);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    recordError(record, "unhandled_promise_rejection", event.reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

export function recordApplicationStartFailure(error: unknown): void {
  recordError(recordFrontendDiagnostic, "application_start_failed", error);
}

function recordError(
  record: DiagnosticRecorder,
  event: string,
  error: unknown,
  componentStack?: string | null,
): void {
  const normalized = normalizeError(error);
  record({
    context: {},
    errorMessage: normalized.message,
    event,
    level: "error",
    stack: componentStack ?? normalized.stack,
  });
}

function normalizeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack ?? null };
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return { message: error, stack: null };
  }
  return { message: "Unknown application error", stack: null };
}
