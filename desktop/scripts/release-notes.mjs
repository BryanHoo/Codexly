import { readFile } from "node:fs/promises";

import { extractVersionNotes } from "./changelog.mjs";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const releaseTag = process.env.RELEASE_TAG?.trim();
const version = releaseTag ? releaseTag.replace(/^v/u, "") : packageJson.version;
const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const releaseNotes = extractVersionNotes(changelog, version);
const delimiter = "CODEAGENT_RELEASE_NOTES";

process.stdout.write(`body<<${delimiter}\n${releaseNotes}\n${delimiter}\n`);
