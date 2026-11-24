import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";
import configuration from "../tsup.config.ts";

/** 每次运行独占构建副本和旧协议夹具，测试期间工作区重建也不会移除浏览器正在请求的资源。 */
export default async function prepareE2e() {
  const artifacts = fileURLToPath(new URL("../.artifacts", import.meta.url));
  await mkdir(artifacts, { recursive: true });
  const runDirectory = await mkdtemp(join(artifacts, "e2e-"));
  const cleanup = () => rm(runDirectory, { recursive: true, force: true });
  try {
    await cp(new URL("../dist", import.meta.url), join(runDirectory, "dist"), { recursive: true });
    await build({
      ...configuration,
      config: false,
      entry: { codex: "packages/provider-codex/src/index.ts" },
      outDir: join(runDirectory, "fixture"),
      clean: false,
    });
    // Playwright 将全局准备阶段设置的路径传给各 worker，LAN 夹具也使用同一份构建。
    process.env["CODEXLY_E2E_RUN_DIRECTORY"] = runDirectory;
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
