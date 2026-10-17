import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// 只测本地合成 SDK 消息和临时历史，不连接用户模型服务；Web、桌面共用同一持久化实现。
const output = resolve(process.argv[2] ?? ".artifacts/claude-history-io");
mkdirSync(output, { recursive: true });
const tracePath = resolve(output, "fs-trace.json");
function run(args) {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, CODEXLY_MEASURE_CLAUDE_HISTORY_IO: "1" },
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) throw new Error(`Measurement failed: ${result.status ?? result.error}`);
  return result.stdout;
}
function metric(stdout, name) {
  const line = stdout.split("\n").find((line) => line.includes(`${name} {`));
  if (!line) throw new Error(`Missing ${name} measurement`);
  return JSON.parse(line.slice(line.indexOf("{")));
}
const checkpoint = metric(
  run([
    "--trace-event-categories",
    "node.fs.async,node.fs.sync",
    "--trace-event-file-pattern",
    tracePath,
    "node_modules/vitest/vitest.mjs",
    "run",
    "--silent=false",
    "--reporter=verbose",
    "--config",
    "vitest.performance.config.ts",
    "packages/provider-claude/src/history-io.performance.test.ts",
  ]),
  "claude-history-checkpoint",
);
const trace = JSON.parse(readFileSync(tracePath, "utf8"));
// 预写必须真实出现在 trace 中，防止未开启 Worker 文件跟踪时得到虚假的零 I/O。
if (
  !trace.traceEvents.some(
    (event) => event.name === "write" && event.ph === "b" && event.ts < checkpoint.startUs,
  )
)
  throw new Error("Node FS trace did not capture the prewritten history");
// 统计 Node/libuv 发出的文件系统 syscall 请求；不是内核 DTrace，也不把异步墙钟解释成主线程阻塞。
const operations = trace.traceEvents.filter(
  (event) =>
    event.cat?.includes("node.fs") &&
    ["b", "B"].includes(event.ph) &&
    event.ts >= checkpoint.startUs &&
    event.ts <= checkpoint.endUs,
);
const byOperation = {};
for (const event of operations) byOperation[event.name] = (byOperation[event.name] ?? 0) + 1;
const writes = trace.traceEvents.filter(
  (event) =>
    event.name === "write" &&
    ["e", "E"].includes(event.ph) &&
    event.ts >= checkpoint.startUs &&
    event.ts <= checkpoint.endUs,
);
const writtenBytes = writes.reduce((sum, event) => sum + Math.max(0, event.args?.result ?? 0), 0);
const publication = metric(
  run([
    "node_modules/vitest/vitest.mjs",
    "run",
    "--silent=false",
    "--reporter=verbose",
    "packages/provider-claude/src/provider.test.ts",
    "-t",
    "reports SDK receive-to-publication",
  ]),
  "claude-sdk-publication",
);
const report = {
  checkpoint: { ...checkpoint, fsSyscallRequests: operations.length, byOperation, writtenBytes },
  sdkPublication: publication,
  method:
    "Node FS trace counts libuv filesystem requests in the steady-state window; SDK latency covers a synthetic 128-message burst with four concurrent active-task reads.",
};
writeFileSync(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
if (operations.length || writtenBytes)
  throw new Error("Unchanged checkpoint performed filesystem I/O");
console.info(JSON.stringify(report, null, 2));
