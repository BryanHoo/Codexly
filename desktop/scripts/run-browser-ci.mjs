import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = fileURLToPath(new URL("../", import.meta.url));

function readReport(path) {
  try {
    const report = JSON.parse(readFileSync(path, "utf8"));
    // JSON 的 success 在连接中断时可能仍为 true，必须结合退出码和断言结果判断。
    if (
      report.numTotalTests > 0 &&
      report.numFailedTests === 0 &&
      report.numFailedTestSuites === 0 &&
      Array.isArray(report.testResults) &&
      report.testResults.every(
        (suite) =>
          Array.isArray(suite.assertionResults) &&
          suite.assertionResults.every((assertion) => assertion.status !== "failed"),
      )
    ) {
      return report;
    }
  } catch {
    // 缺失、损坏或含失败断言的报告都不允许自动恢复，保留原失败供人工定位。
  }
  return null;
}

async function runAttempt({ cliPath, cwd, reportPath, logPath, quiet }) {
  const descriptor = openSync(logPath, "w");
  let tail = "";
  try {
    return await new Promise((resolve) => {
      // 直接使用 Node 启动本地 Vitest，避免 Windows 的 .cmd 与 shell 参数转义差异。
      const child = spawn(
        process.execPath,
        [
          cliPath,
          "run",
          "--config",
          "vitest.browser.config.ts",
          "--reporter=default",
          "--reporter=json",
          `--outputFile=${reportPath}`,
        ],
        { cwd, stdio: ["ignore", "pipe", "pipe"] },
      );
      let error;
      for (const [stream, destination] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
      ]) {
        stream.on("data", (chunk) => {
          writeSync(descriptor, chunk);
          // 只保留末尾 128 Ki 字符用于识别中断；完整现场持续写入独立日志文件。
          tail = (tail + chunk.toString()).slice(-128 * 1024);
          if (!quiet) destination.write(chunk);
        });
      }
      child.on("error", (cause) => {
        error = cause;
      });
      child.on("close", (status, signal) => resolve({ error, signal, status, tail }));
    });
  } finally {
    closeSync(descriptor);
  }
}

export async function runBrowserCI({
  cliPath = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)),
  cwd = desktopRoot,
  outputDirectory = join(cwd, "test-results"),
  quiet = false,
} = {}) {
  mkdirSync(outputDirectory, { recursive: true });
  // 只清理本入口自己的旧文件，防止本地重复执行时把旧报告误作本次有效证据。
  for (const attempt of [1, 2]) {
    for (const extension of ["json", "log"]) {
      rmSync(join(outputDirectory, `browser-attempt-${attempt}.${extension}`), { force: true });
    }
  }
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const reportPath = join(outputDirectory, `browser-attempt-${attempt}.json`);
    const result = await runAttempt({
      cliPath,
      cwd,
      reportPath,
      quiet,
      logPath: join(outputDirectory, `browser-attempt-${attempt}.log`),
    });
    const report = readReport(reportPath);
    if (result.status === 0 && report?.success === true) return 0;

    // 仅恢复单一、明确的浏览器传输中断；断言失败、多个未处理错误和进程信号均直接阻断。
    const connectionClosed = result.tail.includes(
      "[vitest] Browser connection was closed while running tests.",
    );
    const singleTransportError = result.tail.includes(
      "Vitest caught 1 unhandled error during the test run.",
    );
    if (
      attempt === 2 ||
      result.status === 0 ||
      !report ||
      result.error ||
      result.signal ||
      !connectionClosed ||
      !singleTransportError
    ) {
      return 1;
    }
    if (!quiet) console.warn("浏览器连接中断且无失败断言；保留本次现场，启动新进程完整重跑一次。");
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runBrowserCI();
}
