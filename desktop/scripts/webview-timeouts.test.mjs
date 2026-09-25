import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

void test("真实 Codex 冷启动不会被 WDIO 外层 60 秒计时器提前截断", async (t) => {
  const source = await readFile(new URL("../wdio.conf.ts", import.meta.url), "utf8");
  const code = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext });
  const previous = process.env.CODEAGENT_REAL_RUNTIME_TEST;
  process.env.CODEAGENT_REAL_RUNTIME_TEST = "1";
  let config;
  try {
    ({ config } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`));
  } finally {
    if (previous === undefined) delete process.env.CODEAGENT_REAL_RUNTIME_TEST;
    else process.env.CODEAGENT_REAL_RUNTIME_TEST = previous;
  }
  const { executeAsync } = await import(new URL("../../utils/build/index.js", import.meta.resolve("@wdio/mocha-framework")).href);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // 使用当前 WDIO 的真实包装器，模拟下载跨过一分钟后成功，避免只检查配置文本。
  const pending = executeAsync.call(
    { _runnable: { _timeout: config.mochaOpts.timeout } },
    async () => new Promise((resolve) => setTimeout(() => resolve("ready"), 61_000)),
    { attempts: 0, limit: 0 },
  );
  t.mock.timers.tick(61_000);
  assert.equal(await pending, "ready");
});
