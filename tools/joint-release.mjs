import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { extractReleaseNotes } from "./extract-release-notes.mjs";

export function validateJointRelease(tag, webVersion, desktopVersion) {
  if (tag !== `v${webVersion}`) {
    throw new Error(`release tag ${tag} does not match web version ${webVersion}`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(desktopVersion)) {
    throw new Error(`invalid desktop version ${desktopVersion}`);
  }
  if (desktopVersion !== webVersion) {
    throw new Error(`desktop version ${desktopVersion} does not match web version ${webVersion}`);
  }
  return { desktopVersion, webVersion };
}

export function formatJointReleaseNotes(tag, desktopVersion, notes) {
  return `<!-- codeagent-version: ${desktopVersion} -->\n# Codexly ${tag.slice(1)}\n\n${notes.trim()}\n`;
}

async function main() {
  const [mode, argument] = process.argv.slice(2);
  const web = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const desktop = JSON.parse(
    await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"),
  );
  const tag = process.env.RELEASE_TAG?.trim();
  const { webVersion, desktopVersion } = validateJointRelease(tag, web.version, desktop.version);
  const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const notes = extractReleaseNotes(changelog, webVersion);

  if (mode === "--check") {
    process.stdout.write(`web=${webVersion} desktop=${desktopVersion}\n`);
    return;
  }
  if (mode !== "--notes" || !argument) {
    throw new Error("Usage: node tools/joint-release.mjs --check | --notes <output-path>");
  }
  // 两端共用根目录日志，发布正文只输出一次；版本标记供桌面更新检查读取。
  await writeFile(argument, formatJointReleaseNotes(tag, desktopVersion, notes));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
