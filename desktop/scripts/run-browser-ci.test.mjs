import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runBrowserCI } from "./run-browser-ci.mjs";

async function runScenario(t, outcomes, staleReport = false) {
  const cwd = mkdtempSync(join(tmpdir(), "codexly-browser-ci-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const cliPath = join(cwd, "fixture.mjs");
  // 使用真实子进程模拟报告与退出码，验证重试确实重新启动进程并保留每次现场。
  writeFileSync(
    cliPath,
    `
    import { readFileSync, writeFileSync } from 'node:fs';
    const state = JSON.parse(readFileSync('state.json', 'utf8'));
    const outcome = state.outcomes[state.calls++];
    writeFileSync('state.json', JSON.stringify(state));
    if (outcome !== 'missing') {
      const failed = outcome === 'assertion' ? 1 : 0;
      writeFileSync(process.argv.find(arg => arg.startsWith('--outputFile=')).slice(13), outcome === 'invalid' ? '{' : JSON.stringify({
        success: outcome === 'success' || outcome === 'transport', numFailedTests: failed, numFailedTestSuites: failed,
        numTotalTests: 2, testResults: [{ assertionResults: [{ status: failed ? 'failed' : 'passed' }] }]
      }));
    }
    if (outcome !== 'success') {
      console.error('Vitest caught ' + (outcome === 'multiple' ? 2 : 1) + ' unhandled error during the test run.');
      console.error(outcome === 'runtime' ? 'TypeError: application failed' : '[vitest] Browser connection was closed while running tests. Was the page closed unexpectedly?');
    }
    process.exit(outcome === 'success' || outcome === 'partial' ? 0 : 1);
  `,
  );
  writeFileSync(join(cwd, "state.json"), JSON.stringify({ calls: 0, outcomes }));
  const outputDirectory = join(cwd, "reports");
  if (staleReport) {
    mkdirSync(outputDirectory);
    writeFileSync(
      join(outputDirectory, "browser-attempt-1.json"),
      JSON.stringify({
        success: true,
        numTotalTests: 2,
        numFailedTests: 0,
        numFailedTestSuites: 0,
        testResults: [],
      }),
    );
  }
  const status = await runBrowserCI({ cliPath, cwd, outputDirectory, quiet: true });
  const { calls } = JSON.parse(readFileSync(join(cwd, "state.json"), "utf8"));
  return { calls, outputDirectory, status };
}

await test("连接中断后启动全新进程，完整成功才放行，并保留两次报告", async (t) => {
  const { calls, outputDirectory, status } = await runScenario(t, ["transport", "success"]);
  assert.equal(status, 0);
  assert.equal(calls, 2);
  assert.equal(
    JSON.parse(readFileSync(join(outputDirectory, "browser-attempt-1.json"))).success,
    true,
  );
  assert.equal(
    JSON.parse(readFileSync(join(outputDirectory, "browser-attempt-2.json"))).success,
    true,
  );
  assert.match(
    readFileSync(join(outputDirectory, "browser-attempt-1.log"), "utf8"),
    /Browser connection was closed/,
  );
});

await test("即使伴随连接退出，真实断言失败仍直接阻断", async (t) => {
  const { calls, status } = await runScenario(t, ["assertion", "success"]);
  assert.equal(status, 1);
  assert.equal(calls, 1);
});

await test("没有有效报告时不把未知失败当作可恢复的连接故障", async (t) => {
  const { calls, status } = await runScenario(t, ["missing", "success"]);
  assert.equal(status, 1);
  assert.equal(calls, 1);
});

await test("连接连续中断时最多重试一次并保留失败退出码", async (t) => {
  const { calls, status } = await runScenario(t, ["transport", "transport", "success"]);
  assert.equal(status, 1);
  assert.equal(calls, 2);
});

await test("首次完整成功时不重复执行浏览器套件", async (t) => {
  const { calls, status } = await runScenario(t, ["success"]);
  assert.equal(status, 0);
  assert.equal(calls, 1);
});

await test("旧报告不能把本次缺失报告的失败伪装成可恢复中断", async (t) => {
  const { calls, status } = await runScenario(t, ["missing", "success"], true);
  assert.equal(status, 1);
  assert.equal(calls, 1);
});

await test("损坏报告、其他异常、多个未处理错误与成功退出的矛盾报告均阻断", async (t) => {
  for (const outcome of ["invalid", "runtime", "multiple", "partial"]) {
    const { calls, status } = await runScenario(t, [outcome, "success"]);
    assert.equal(status, 1, outcome);
    assert.equal(calls, 1, outcome);
  }
});
