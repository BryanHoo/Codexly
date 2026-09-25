import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractVersionNotes } from "./changelog.mjs";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(workspaceRoot, "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(workspaceRoot, relativePath), "utf8"));
}

const packageVersion = readJson("package.json").version;
const webVersion = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")).version;
const tauriVersion = readJson("src-tauri/tauri.conf.json").version;
const cargoMetadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version=1",
      "--no-deps",
      "--manifest-path",
      "src-tauri/Cargo.toml",
    ],
    { cwd: workspaceRoot, encoding: "utf8" },
  ),
);
const cargoPackage = cargoMetadata.packages.find((item) => item.name === "codeagent");

if (!cargoPackage) {
  throw new Error("codeagent Cargo package was not found");
}

const versions = new Set([webVersion, packageVersion, tauriVersion, cargoPackage.version]);

if (versions.size !== 1) {
  throw new Error(
    `version mismatch: web=${webVersion}, desktop=${packageVersion}, tauri=${tauriVersion}, cargo=${cargoPackage.version}`,
  );
}

const releaseTag = process.env.RELEASE_TAG?.trim();

// 联合发布的标签必须与 Web 和桌面安装包元数据一致。
if (releaseTag && releaseTag !== `v${packageVersion}`) {
  throw new Error(`release tag ${releaseTag} does not match v${packageVersion}`);
}

const changelog = readFileSync(resolve(workspaceRoot, "CHANGELOG.md"), "utf8");
extractVersionNotes(changelog, packageVersion);

process.stdout.write(`version ${packageVersion} is consistent\n`);
