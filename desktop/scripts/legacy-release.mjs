import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function legacyUpdateManifest(version, signature, repository, releaseTag) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version) || !signature.trim()
    || !/^[\w.-]+\/[\w.-]+$/.test(repository)
    || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseTag)) {
    throw new Error("Invalid Legacy updater metadata");
  }
  return {
    version,
    platforms: {
      "darwin-x86_64": {
        signature: signature.trim(),
        url: `https://github.com/${repository}/releases/download/${releaseTag}/Codexly_${version}_x64_legacy.app.tar.gz`,
      },
    },
  };
}

if (import.meta.main) {
  const paths = JSON.parse(process.env.ARTIFACT_PATHS || "[]");
  const signatures = paths.filter((path) => path.includes("x86_64-apple-darwin") && path.endsWith(".app.tar.gz.sig"));
  if (signatures.length !== 1 || !process.env.RUNNER_TEMP) {
    throw new Error("Expected exactly one signed Intel Legacy updater archive");
  }
  const signature = await readFile(signatures[0], "utf8");
  const manifest = legacyUpdateManifest(process.env.APP_VERSION, signature, process.env.GITHUB_REPOSITORY, process.env.JOINT_RELEASE_TAG);
  // 单独上传清单，绝不让 tauri-action 用 Legacy 的相同平台键覆盖 Modern latest.json。
  await writeFile(join(process.env.RUNNER_TEMP, "latest-legacy.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
