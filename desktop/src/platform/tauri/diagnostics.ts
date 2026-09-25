import type {
  ExportDiagnosticsResponse,
  FrontendDiagnosticInput,
} from "@/protocol/index.js";

import { invoke } from "./native-invoke.js";

export function recordFrontendDiagnostic(input: FrontendDiagnosticInput): void {
  // 诊断链路不可影响主流程；原生端不可用时直接丢弃本条事件。
  void invoke<void>("record_frontend_diagnostic", { input }).catch(() => undefined);
}

export async function exportDiagnostics(): Promise<ExportDiagnosticsResponse> {
  return invoke("export_diagnostics");
}
