import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { extractVersionNotes } from "../desktop/scripts/changelog.mjs";
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

export function formatJointReleaseNotes(tag, desktopVersion, webNotes, desktopNotes) {
  return `<!-- codeagent-version: ${desktopVersion} -->\n# Codexly ${tag.slice(1)}\n\n${webNotes.trim()}\n\n# Codexly Desktop ${desktopVersion}\n\n${desktopNotes.trim()}\n`;
}

async function main() {
  const [mode, argument] = process.argv.slice(2);
  const web = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const desktop = JSON.parse(
    await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"),
  );
  const tag = process.env.RELEASE_TAG?.trim();
  const { webVersion, desktopVersion } = validateJointRelease(tag, web.version, desktop.version);
  const webChangelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const desktopChangelog = await readFile(
    new URL("../desktop/CHANGELOG.md", import.meta.url),
    "utf8",
  );
  const webNotes = extractReleaseNotes(webChangelog, webVersion);
  const desktopNotes = extractVersionNotes(desktopChangelog, desktopVersion);

  if (mode === "--check") {
    process.stdout.write(`web=${webVersion} desktop=${desktopVersion}\n`);
    return;
  }
  if (mode !== "--notes" || !argument) {
    throw new Error("Usage: node tools/joint-release.mjs --check | --notes <output-path>");
  }
  // Web 与桌面使用同一标签和版本，发布正文同时保留两端的更新内容。
  await writeFile(argument, formatJointReleaseNotes(tag, desktopVersion, webNotes, desktopNotes));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
