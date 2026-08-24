import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const precompressorPath = join(process.cwd(), "tools/precompress-web-assets.mjs");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Web 构建产物预压缩", () => {
  it("为可压缩文件生成 Brotli 和 Gzip 旁路文件", () => {
    const root = mkdtempSync(join(tmpdir(), "codexly-precompress-"));
    temporaryRoots.push(root);
    const htmlBody = "<main>Codexly Web</main>";
    const javascriptBody = "export const value = 'Codexly';\n".repeat(64);
    writeFileSync(join(root, "index.html"), htmlBody);
    writeFileSync(join(root, "index.js"), javascriptBody);
    writeFileSync(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = spawnSync(process.execPath, [precompressorPath, root], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(brotliDecompressSync(readFileSync(join(root, "index.html.br"))).toString()).toBe(
      htmlBody,
    );
    expect(gunzipSync(readFileSync(join(root, "index.html.gz"))).toString()).toBe(htmlBody);
    expect(brotliDecompressSync(readFileSync(join(root, "index.js.br"))).toString()).toBe(
      javascriptBody,
    );
    expect(gunzipSync(readFileSync(join(root, "index.js.gz"))).toString()).toBe(javascriptBody);
    expect(() => readFileSync(join(root, "logo.png.br"))).toThrow();
    expect(() => readFileSync(join(root, "logo.png.gz"))).toThrow();
  });

  it("由 Web build 脚本在 Vite 构建后执行", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "apps/web/package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts["build"]).toBe(
      "vite build && node ../../tools/precompress-web-assets.mjs ../../dist/web",
    );
  });
});
