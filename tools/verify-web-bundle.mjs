import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const initialGzipBudgetBytes = 280 * 1024;
const maxAsyncGzipBudgetBytes = 200 * 1024;
const workbenchReadyGzipBudgetBytes = 500 * 1024;
const workbenchReadyRequestBudget = 20;
const workbenchEntryKey = "src/features/workbench/components/workbench-shell.tsx";
const reportSchemaVersion = 2;
const topContributorCount = 5;

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function readManifest(root) {
  const manifestPath = resolve(root, ".vite/manifest.json");
  const value = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid Vite manifest: expected an object");
  }
  return value;
}

function readChunk(manifest, key) {
  const chunk = manifest[key];
  if (chunk === null || typeof chunk !== "object" || Array.isArray(chunk)) {
    throw new Error(`unknown manifest chunk: ${key}`);
  }
  if (typeof chunk.file !== "string") {
    throw new Error(`invalid manifest chunk file: ${key}`);
  }
  if (
    chunk.imports !== undefined &&
    (!Array.isArray(chunk.imports) || chunk.imports.some((item) => typeof item !== "string"))
  ) {
    throw new Error(`invalid manifest chunk imports: ${key}`);
  }
  return chunk;
}

function collectStaticGraph(manifest, roots, excluded = new Set()) {
  const chunks = new Set();
  const visit = (key) => {
    if (chunks.has(key) || excluded.has(key)) return;
    const chunk = readChunk(manifest, key);
    chunks.add(key);
    for (const importedKey of chunk.imports ?? []) {
      visit(importedKey);
    }
  };
  for (const root of roots) visit(root);
  return chunks;
}

function measureGraph(root, manifest, graph) {
  let gzipBytes = 0;
  const contributors = [];
  for (const key of graph) {
    const { file } = readChunk(manifest, key);
    if (!file.endsWith(".js")) continue;
    const fileGzipBytes = gzipSync(readFileSync(resolve(root, file))).byteLength;
    gzipBytes += fileGzipBytes;
    contributors.push({ file, gzipBytes: fileGzipBytes });
  }
  return {
    contributors: contributors.toSorted(
      (left, right) => right.gzipBytes - left.gzipBytes || left.file.localeCompare(right.file),
    ),
    gzipBytes,
    requestCount: contributors.length,
  };
}

function analyzeBundle(root, manifest) {
  const entries = Object.keys(manifest).filter((key) => readChunk(manifest, key).isEntry === true);
  if (entries.length === 0) {
    throw new Error("invalid Vite manifest: no JavaScript entry found");
  }

  // 首屏统计入口及其全部静态依赖；异步组只统计首屏尚未下载的静态闭包。
  const initialGraph = collectStaticGraph(manifest, entries);
  const initial = measureGraph(root, manifest, initialGraph);
  const workbenchReady = measureGraph(
    root,
    manifest,
    collectStaticGraph(manifest, [...entries, workbenchEntryKey]),
  );
  const asyncGroups = Object.keys(manifest)
    .filter((key) => readChunk(manifest, key).isDynamicEntry === true)
    .map((key) => ({
      key,
      ...measureGraph(root, manifest, collectStaticGraph(manifest, [key], initialGraph)),
    }))
    .toSorted((left, right) => right.gzipBytes - left.gzipBytes);

  return { asyncGroups, initial, workbenchReady };
}

function createReport(analysis) {
  const violations = [];
  if (analysis.initial.gzipBytes > initialGzipBudgetBytes) {
    violations.push({
      actualGzipBytes: analysis.initial.gzipBytes,
      budgetGzipBytes: initialGzipBudgetBytes,
      kind: "initial",
    });
  }
  if (analysis.workbenchReady.gzipBytes > workbenchReadyGzipBudgetBytes) {
    violations.push({
      actualGzipBytes: analysis.workbenchReady.gzipBytes,
      budgetGzipBytes: workbenchReadyGzipBudgetBytes,
      kind: "workbench-ready-gzip",
    });
  }
  if (analysis.workbenchReady.requestCount > workbenchReadyRequestBudget) {
    violations.push({
      actualRequestCount: analysis.workbenchReady.requestCount,
      budgetRequestCount: workbenchReadyRequestBudget,
      kind: "workbench-ready-requests",
    });
  }
  const largestAsync = analysis.asyncGroups[0] ?? null;
  if (largestAsync !== null && largestAsync.gzipBytes > maxAsyncGzipBudgetBytes) {
    violations.push({
      actualGzipBytes: largestAsync.gzipBytes,
      budgetGzipBytes: maxAsyncGzipBudgetBytes,
      key: largestAsync.key,
      kind: "async",
    });
  }

  return {
    asyncGroups: analysis.asyncGroups,
    budgets: {
      initialGzipBytes: initialGzipBudgetBytes,
      maxAsyncGzipBytes: maxAsyncGzipBudgetBytes,
      workbenchReadyGzipBytes: workbenchReadyGzipBudgetBytes,
      workbenchReadyRequestCount: workbenchReadyRequestBudget,
    },
    initial: analysis.initial,
    passed: violations.length === 0,
    schemaVersion: reportSchemaVersion,
    violations,
    workbenchReady: analysis.workbenchReady,
  };
}

function assertReport(report) {
  if (report.violations.length === 0) return;

  const errors = report.violations.map((violation) => {
    if (violation.kind === "initial") {
      return `initial gzip budget exceeded: ${formatKiB(violation.actualGzipBytes)} > ${formatKiB(violation.budgetGzipBytes)}`;
    }
    if (violation.kind === "workbench-ready-gzip") {
      return `workbench-ready gzip budget exceeded: ${formatKiB(violation.actualGzipBytes)} > ${formatKiB(violation.budgetGzipBytes)}`;
    }
    if (violation.kind === "workbench-ready-requests") {
      return `workbench-ready request budget exceeded: ${String(violation.actualRequestCount)} > ${String(violation.budgetRequestCount)}`;
    }
    return `async gzip budget exceeded: ${formatKiB(violation.actualGzipBytes)} > ${formatKiB(violation.budgetGzipBytes)} (${violation.key})`;
  });
  throw new Error(`Web Bundle budget failed\n- ${errors.join("\n- ")}`);
}

function writeReport(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

function readReport(path) {
  const report = JSON.parse(readFileSync(path, "utf8"));
  if (
    report === null ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.schemaVersion !== reportSchemaVersion ||
    !Array.isArray(report.asyncGroups) ||
    !Array.isArray(report.initial?.contributors) ||
    !Array.isArray(report.workbenchReady?.contributors) ||
    typeof report.workbenchReady?.requestCount !== "number" ||
    !Array.isArray(report.violations)
  ) {
    throw new Error("invalid Web Bundle report");
  }
  return report;
}

function printReport(report) {
  const largestAsync = report.asyncGroups[0] ?? null;
  const asyncSummary =
    largestAsync === null ? "none" : `${formatKiB(largestAsync.gzipBytes)} (${largestAsync.key})`;
  console.log(
    `Web Bundle budget ${report.passed ? "passed" : "failed"}: initial ${formatKiB(report.initial.gzipBytes)} / ${formatKiB(report.budgets.initialGzipBytes)}; workbench ready ${formatKiB(report.workbenchReady.gzipBytes)} / ${formatKiB(report.budgets.workbenchReadyGzipBytes)} in ${String(report.workbenchReady.requestCount)} / ${String(report.budgets.workbenchReadyRequestCount)} requests; max async ${asyncSummary} / ${formatKiB(report.budgets.maxAsyncGzipBytes)}`,
  );
  printContributors("Initial Top Contributors", report.initial.contributors);
  printContributors("Workbench Ready Top Contributors", report.workbenchReady.contributors);
}

function printContributors(title, contributors) {
  console.log(`${title}:`);
  const topContributors = contributors.slice(0, topContributorCount);
  if (topContributors.length === 0) {
    console.log("- none");
    return;
  }
  for (const contributor of topContributors) {
    console.log(`- ${contributor.file}: ${formatKiB(contributor.gzipBytes)}`);
  }
}

function parseArguments(args) {
  let readReportPath = null;
  let reportPath = null;
  let root = "dist/web";
  let rootProvided = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--report" || argument === "--read-report") {
      const value = args[index + 1];
      if (value === undefined) throw new Error(`missing value for ${argument}`);
      if (argument === "--report") reportPath = resolve(value);
      else readReportPath = resolve(value);
      index += 1;
      continue;
    }
    if (argument?.startsWith("--") === true) throw new Error(`unknown argument: ${argument}`);
    if (rootProvided) throw new Error(`unexpected argument: ${argument}`);
    root = argument;
    rootProvided = true;
  }
  if (readReportPath !== null && (reportPath !== null || rootProvided)) {
    throw new Error("--read-report cannot be combined with a bundle root or --report");
  }
  return { readReportPath, reportPath, root: resolve(root) };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const report =
    options.readReportPath === null
      ? createReport(analyzeBundle(options.root, readManifest(options.root)))
      : readReport(options.readReportPath);
  if (options.reportPath !== null) writeReport(options.reportPath, report);
  printReport(report);
  assertReport(report);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
