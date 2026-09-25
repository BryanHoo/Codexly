import { Channel } from "@tauri-apps/api/core";
import type {
  CodexRuntimeAvailability,
  CodexRuntimeInstallProgress,
} from "@/protocol/index.js";

import { invoke } from "./native-invoke.js";

function createProgressChannel(
  onProgress: (progress: CodexRuntimeInstallProgress) => void,
): Channel<CodexRuntimeInstallProgress> {
  let latestSequence = 0;
  return new Channel<CodexRuntimeInstallProgress>((progress) => {
    if (progress.sequence <= latestSequence) return;
    latestSequence = progress.sequence;
    onProgress(progress);
  });
}

export function inspectCodexRuntime(
  onProgress: (progress: CodexRuntimeInstallProgress) => void = () => undefined,
): Promise<CodexRuntimeAvailability> {
  return invoke<CodexRuntimeAvailability>("inspect_codex_runtime", {
    onProgress: createProgressChannel(onProgress),
  });
}

export function downloadAndInspectCodexRuntime(
  onProgress: (progress: CodexRuntimeInstallProgress) => void = () => undefined,
): Promise<CodexRuntimeAvailability> {
  return invoke<CodexRuntimeAvailability>("install_codex_runtime", {
    onProgress: createProgressChannel(onProgress),
  });
}
