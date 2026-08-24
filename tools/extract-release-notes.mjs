import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function extractReleaseNotes(changelog, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## \\[${escapedVersion}\\](?:\\s+-\\s+.*)?$`, "m");
  const match = heading.exec(changelog);

  if (match === null) {
    throw new Error(`CHANGELOG.md does not contain version ${version}`);
  }

  // 当前版本正文截止到下一个二级标题，避免把旧版本日志一并发布。
  const bodyStart = match.index + match[0].length;
  const remaining = changelog.slice(bodyStart);
  const nextHeading = remaining.search(/^## /m);
  const notes = (nextHeading === -1 ? remaining : remaining.slice(0, nextHeading)).trim();

  if (notes.length === 0) {
    throw new Error(`CHANGELOG.md version ${version} has no release notes`);
  }

  return notes;
}

async function main() {
  const [version, outputPath] = process.argv.slice(2);
  if (version === undefined || outputPath === undefined) {
    throw new Error("Usage: node tools/extract-release-notes.mjs <version> <output-path>");
  }

  const changelog = await readFile("CHANGELOG.md", "utf8");
  await writeFile(outputPath, `${extractReleaseNotes(changelog, version)}\n`, "utf8");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
