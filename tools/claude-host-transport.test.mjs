import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const resources = fileURLToPath(new URL("../desktop/src-tauri/resources/claude/", import.meta.url));
const suffix = process.platform === "win32" ? ".exe" : "";

// 原生独立宿主故障注入；不启动 SDK 查询，不读取或改写用户认证配置。
for (const [name, input, paused] of [
  ["bad stdin frame", "not-json\n", false],
  ["invalid stdin envelope", "{}\n", false],
  ["broken stdout pipe", '{"id":1,"method":"settings.read"}\n', "broken"],
  ["oversized stdin frame", "x".repeat(8 * 1024 * 1024 + 1), false],
  [
    "paused stdout consumer",
    Array.from({ length: 20000 }, (_, index) =>
      JSON.stringify({
        id: index + 1,
        method: "invalid",
        scope: { id: "p", kind: "project", rootPath: "/unused" },
      }),
    ).join("\n") + "\n",
    true,
  ],
]) {
  test(
    `standalone host exits safely after ${name} and can restart`,
    { timeout: 12000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "codexly-host-fault-"));
      const child = spawn(
        join(resources, `claude-host${suffix}`),
        [directory, join(resources, `claude${suffix}`)],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let diagnostic = "";
      child.stderr.on("data", (chunk) => {
        diagnostic = `${diagnostic}${chunk}`.slice(-2048);
      });
      child.stdin.on("error", () => {
        /* 宿主故障关闭会产生预期 EPIPE。 */
      });
      if (paused === "broken") child.stdout.destroy();
      else if (!paused) child.stdout.resume();
      const timer = setTimeout(() => child.kill(), 8000);
      try {
        const exited = once(child, "exit");
        child.stdin.write(input);
        const [code, signal] = await exited;
        assert.equal(signal, null, diagnostic);
        assert.equal(code, 1, diagnostic);
        assert.match(diagnostic, /Claude host transport:/u);
        // 故障不改变分发文件或用户配置；新的独立宿主仍可正常响应版本探测。
        const fresh = spawn(join(resources, `claude-host${suffix}`), ["--version"]);
        let version = "";
        fresh.stdout.on("data", (chunk) => {
          version += chunk;
        });
        const [freshCode] = await once(fresh, "exit");
        assert.equal(freshCode, 0);
        assert.match(version, /codexly-claude-host\/1 sdk\//u);
      } finally {
        clearTimeout(timer);
        child.kill();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
