import { constants } from "node:zlib";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".txt",
  ".wasm",
  ".xml",
]);

async function collectCompressibleFiles(root) {
  const files = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectCompressibleFiles(path)));
    } else if (entry.isFile() && COMPRESSIBLE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

async function precompressFile(path) {
  const source = await readFile(path);
  // 构建阶段优先压缩率，换取发布后的零压缩 CPU 开销与更小传输体积。
  const [brotli, gzipped] = await Promise.all([
    brotliCompressAsync(source, {
      params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
    }),
    gzipAsync(source, { level: constants.Z_BEST_COMPRESSION }),
  ]);
  await Promise.all([writeFile(`${path}.br`, brotli), writeFile(`${path}.gz`, gzipped)]);
}

const targetArgument = process.argv[2];
if (targetArgument === undefined) {
  throw new Error("Web asset directory argument is required");
}
const targetRoot = resolve(targetArgument);
const targetStat = await stat(targetRoot).catch(() => undefined);
if (!targetStat?.isDirectory()) {
  throw new Error(`Web asset directory does not exist: ${targetRoot}`);
}

const files = await collectCompressibleFiles(targetRoot);
for (const file of files) {
  await precompressFile(file);
}
process.stdout.write(`Precompressed ${String(files.length)} Web assets\n`);
