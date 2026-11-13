import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const binary =
  process.env.CODEXLY_COMPILED_ACP_HOST ??
  join(root, `.artifacts/acp/acp-host${process.platform === "win32" ? ".exe" : ""}`);
if (!process.env.CODEXLY_COMPILED_ACP_HOST) {
  const built = spawnSync(process.execPath, [join(root, "tools/build-acp-host.mjs"), binary], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}
// 必须实际指定编译产物，禁止把测试的 skip 分支当作宿主验证通过。
const tested = spawnSync(
  process.execPath,
  [
    "--test",
    "tools/acp-host.test.mjs",
    "tools/acp-host-queue.test.mjs",
    "tools/acp-proxy-compiled.test.mjs",
    "tools/acp-runtime-layout.test.mjs",
  ],
  { cwd: root, stdio: "inherit", env: { ...process.env, CODEXLY_COMPILED_ACP_HOST: binary } },
);
process.exit(tested.status ?? 1);
