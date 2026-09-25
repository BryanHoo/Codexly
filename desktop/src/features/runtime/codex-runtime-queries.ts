import type { QueryFunctionContext } from "@tanstack/react-query";

import { inspectCodexRuntime } from "../../platform/tauri/codex-runtime-manager.js";
import { connectCodexRuntime } from "../../platform/tauri/runtime.js";
import type { CodexRuntimeInstallProgress } from "../../protocol/index.js";

export const CODEX_RUNTIME_QUERY_KEY = ["codex-runtime-availability"] as const;
type RuntimeProgressListener = (progress: CodexRuntimeInstallProgress) => void;

function isRuntimeProgressListener(value: unknown): value is RuntimeProgressListener {
  return typeof value === "function";
}

export function inspectRuntimeDirectQuery({ meta }: QueryFunctionContext) {
  const onProgress = meta?.["onProgress"];
  return inspectCodexRuntime(isRuntimeProgressListener(onProgress) ? onProgress : undefined);
}

export async function inspectRuntimeQuery(context: QueryFunctionContext) {
  // 先连接后台权威状态，恢复窗口时复用已验证的进程，避免重复版本探测和自动更新。
  if ((await connectCodexRuntime()).status === "ready") return null;
  const onInspect = context.meta?.["onInspect"];
  if (typeof onInspect === "function") onInspect();
  return inspectRuntimeDirectQuery(context);
}
