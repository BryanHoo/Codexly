import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const directory = new URL("../desktop/src-tauri/resources/claude/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
const tag = process.argv[2];
if (tag !== `v${manifest.host.version}`) throw new Error("Claude host release version mismatch");
const artifact = new URL(manifest.host.url).pathname.split("/").at(-1);
const path = fileURLToPath(new URL(artifact, directory));
const hash = createHash("sha512");
for await (const chunk of createReadStream(path)) hash.update(chunk);
if (hash.digest("base64") !== manifest.host.integrity)
  throw new Error("Claude host release integrity mismatch");
const result = spawnSync("gh", ["release", "upload", tag, path, "--clobber"], { stdio: "inherit" });
if (result.status !== 0) throw result.error ?? new Error("Claude host upload failed");
