import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function collectInitialKeys(manifest) {
  const entries = Object.entries(manifest)
    .filter(([, value]) => value.isEntry)
    .map(([key]) => key);
  return collectStaticKeys(manifest, entries);
}

function collectStaticKeys(manifest, roots) {
  const visited = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    if (manifest[key] === undefined) throw new Error(`Missing performance entry: ${key}`);
    visited.add(key);
    for (const dependency of manifest[key]?.imports ?? []) visit(dependency);
  };
  for (const key of roots) visit(key);
  return visited;
}

function summarizeStaticLoad(manifest, sizes, roots) {
  const files = new Set();
  for (const key of collectStaticKeys(manifest, roots)) {
    const chunk = manifest[key];
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
  }
  return {
    bytes: [...files].reduce((total, file) => total + (sizes.get(file) ?? 0), 0),
    chunkCount: files.size,
  };
}

export function analyzeBundle(manifest, sizes, scenarioRoots = {}) {
  const initialKeys = collectInitialKeys(manifest);
  const initialFiles = new Set();
  for (const key of initialKeys) {
    const chunk = manifest[key];
    if (chunk === undefined) continue;
    initialFiles.add(chunk.file);
    for (const css of chunk.css ?? []) initialFiles.add(css);
  }
  const toEntry = (file) => ({ bytes: sizes.get(file) ?? 0, file });
  const initialChunks = [...initialFiles].sort((left, right) => left.localeCompare(right)).map(toEntry);
  // 动态入口的静态依赖同样会占用解析和传输预算，必须覆盖全部非首屏 JS Chunk。
  const asyncFiles = new Set(
    Object.entries(manifest)
      .filter(([key, chunk]) => !initialKeys.has(key) && chunk.file.endsWith(".js"))
      .map(([, chunk]) => chunk.file),
  );
  return {
    asyncChunks: [...asyncFiles].sort((left, right) => left.localeCompare(right)).map(toEntry),
    initialBytes: initialChunks.reduce((total, chunk) => total + chunk.bytes, 0),
    initialChunks,
    scenarios: Object.fromEntries(
      Object.entries(scenarioRoots).map(([name, roots]) => [
        name,
        summarizeStaticLoad(manifest, sizes, roots),
      ]),
    ),
  };
}

function resolveScenarioRoots(manifest) {
  const cppLanguageEntry = Object.keys(manifest).find((key) =>
    key.endsWith("/shiki/dist/langs/cpp.mjs"),
  );
  if (cppLanguageEntry === undefined) {
    throw new Error("Missing C++ highlighting performance entry");
  }
  const workspace = "src/features/workbench/components/workbench-shell.tsx";
  return {
    cppHighlight: [
      workspace,
      "src/shared/components/agent/code-highlighter.ts",
      cppLanguageEntry,
    ],
    markdown: [workspace, "src/shared/components/agent/message-response.tsx"],
    workspace: [workspace],
    taskWindow: ["src/features/task-window/task-window.tsx"],
  };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dist = path.join(root, "dist");
  const manifest = JSON.parse(await readFile(path.join(dist, ".vite/manifest.json"), "utf8"));
  const budget = JSON.parse(await readFile(path.join(root, "performance-budget.json"), "utf8"));
  const files = new Set(Object.values(manifest).flatMap((chunk) => [chunk.file, ...(chunk.css ?? [])]));
  const sizes = new Map();
  for (const file of files) sizes.set(file, (await stat(path.join(dist, file))).size);
  // 场景预算统计完整静态依赖闭包，避免拆 Chunk 后绕过单文件上限。
  const report = analyzeBundle(manifest, sizes, resolveScenarioRoots(manifest));
  const largestAsyncBytes = Math.max(0, ...report.asyncChunks.map((chunk) => chunk.bytes));
  console.log(JSON.stringify({ ...report, largestAsyncBytes }, null, 2));
  const failures = [];
  if (report.initialBytes > budget.initialLoadBytes) {
    failures.push(`initial load ${report.initialBytes} > ${budget.initialLoadBytes} bytes`);
  }
  if (largestAsyncBytes > budget.asyncChunkBytes) {
    failures.push(`largest async chunk ${largestAsyncBytes} > ${budget.asyncChunkBytes} bytes`);
  }
  for (const [name, maximumBytes] of Object.entries(budget.scenarioLoadBytes)) {
    const actualBytes = report.scenarios[name]?.bytes;
    if (actualBytes === undefined) {
      failures.push(`missing ${name} load measurement`);
    } else if (actualBytes > maximumBytes) {
      failures.push(`${name} load ${actualBytes} > ${maximumBytes} bytes`);
    }
  }
  if (failures.length > 0) throw new Error(`Performance budget exceeded: ${failures.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
