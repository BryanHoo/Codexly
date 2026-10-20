import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { createCodexRuntimeProvider as createRuntime } from "./agent-provider.js";

let appDataDirectory: string;
beforeEach(async () => {
  // 应用目录独立于 CODEX_HOME；每个测试显式隔离，禁止读写用户历史或跨测试恢复分叉。
  appDataDirectory = await mkdtemp(join(tmpdir(), "codexly-provider-"));
});
afterEach(async () => {
  await rm(appDataDirectory, { recursive: true, force: true });
});

export function createCodexRuntimeProvider(options: Parameters<typeof createRuntime>[0]) {
  return createRuntime({ appDataDirectory, ...options });
}
