import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

it("Docker 依赖层在冻结安装前包含所有工作区清单", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const dependencies =
    dockerfile
      .split("FROM build-tools AS dependencies")[1]
      ?.split("FROM dependencies AS build")[0] ?? "";
  const installStart = dependencies.indexOf("pnpm --filter '!codeagent' install --frozen-lockfile");
  expect(installStart).toBeGreaterThan(0);
  const manifestCopies = dependencies.slice(0, installStart);
  const manifests = ["desktop/package.json"];

  // 缺少共享包清单会触发 catalog 自动清理，使后续生产依赖裁剪与锁文件不一致。
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(parent, entry.name, "package.json");
      if (existsSync(manifest)) manifests.push(manifest.replaceAll("\\", "/"));
    }
  }

  for (const manifest of manifests) {
    expect(manifestCopies, `Missing workspace manifest: ${manifest}`).toContain(
      `COPY ${manifest} ./${manifest}`,
    );
  }
});
