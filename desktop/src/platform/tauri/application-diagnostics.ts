import {
  createReactDiagnosticHandlers as createHandlers,
  installGlobalDiagnostics as installDiagnostics,
  recordApplicationError,
  type DiagnosticRecorder,
} from "@codexly/frontend-core/application-diagnostics";
import { recordFrontendDiagnostic } from "./diagnostics.js";

// 两端共用异常监听与归一化，桌面继续交给原生层脱敏并写入轮转日志。
export function createReactDiagnosticHandlers(record: DiagnosticRecorder = recordFrontendDiagnostic) {
  return createHandlers(record);
}

export function installGlobalDiagnostics(
  target: Window = window,
  record: DiagnosticRecorder = recordFrontendDiagnostic,
): () => void {
  return installDiagnostics(target, record);
}

export function recordApplicationStartFailure(error: unknown): void {
  recordApplicationError(recordFrontendDiagnostic, "application_start_failed", error);
}
