import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { unzip } from "fflate";
import type { SkillInstallResult } from "@codexly/protocol";

import { isCodexCompatibleSkill } from "./skill-market-compatibility.js";
import { SkillMarketError } from "./skill-market-error.js";

export { SkillMarketError } from "./skill-market-error.js";

const MAX_FILES = 2_048;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

export type DownloadedSkillArchive = Readonly<{
  bytes: Uint8Array;
  contentHash: string | null;
  sourcePath: string | null;
}>;

type SkillOrigin = Readonly<{
  fingerprint: string;
  installedVersion: string;
  ownerHandle: string;
  registry: string;
  slug: string;
  version: 1;
}>;

function invalidArchive(message: string): SkillMarketError {
  return new SkillMarketError("SKILL_MARKET_INVALID_ARCHIVE", message);
}

function archiveParts(path: string): string[] | undefined {
  if (path.length === 0 || path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    return undefined;
  }
  const parts = path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part.length > 0);
  return parts.length > 0 && parts.every((part) => part !== "." && part !== "..")
    ? parts
    : undefined;
}

function extractRelativePath(path: string, sourcePath: string | null): string | undefined {
  const parts = archiveParts(path);
  if (parts === undefined) return undefined;
  if (sourcePath === null) return parts.join("/");
  const sourceParts = archiveParts(sourcePath);
  if (sourceParts === undefined) throw invalidArchive("Skill source path is invalid");
  const githubPath = parts.slice(1);
  if (!sourceParts.every((part, index) => githubPath[index] === part)) return "";
  const selected = githubPath.slice(sourceParts.length);
  return selected.length === 0 ? "" : selected.join("/");
}

function decompressArchive(
  bytes: Uint8Array,
  sourcePath: string | null,
): Promise<ReadonlyMap<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    let declaredBytes = 0;
    let fileCount = 0;
    let validationError: SkillMarketError | undefined;
    unzip(
      bytes,
      {
        filter(file) {
          fileCount += 1;
          declaredBytes += file.originalSize;
          const path = extractRelativePath(file.name, sourcePath);
          if (
            fileCount > MAX_FILES ||
            declaredBytes > MAX_UNCOMPRESSED_BYTES ||
            path === undefined
          ) {
            validationError = invalidArchive("Skill archive exceeds safety limits");
            return false;
          }
          return path.length > 0;
        },
      },
      (error, extracted) => {
        if (error !== null) {
          reject(invalidArchive("Skill archive cannot be decompressed"));
          return;
        }
        if (validationError !== undefined) {
          reject(validationError);
          return;
        }
        const files = new Map<string, Uint8Array>();
        let actualBytes = 0;
        for (const [archivePath, content] of Object.entries(extracted)) {
          const path = extractRelativePath(archivePath, sourcePath);
          if (path === undefined) {
            reject(invalidArchive("Skill archive path is invalid"));
            return;
          }
          if (path.length === 0 || archivePath.endsWith("/")) continue;
          actualBytes += content.byteLength;
          if (actualBytes > MAX_UNCOMPRESSED_BYTES) {
            reject(invalidArchive("Skill archive is too large"));
            return;
          }
          files.set(path, content);
        }
        if (files.size === 0) {
          reject(invalidArchive("Skill archive is empty"));
          return;
        }
        resolve(files);
      },
    );
  });
}

async function extractArchive(
  archive: DownloadedSkillArchive,
  destination: string,
): Promise<string> {
  const files = await decompressArchive(archive.bytes, archive.sourcePath);
  await Promise.all(
    [...files].map(async ([path, content]) => {
      const output = join(destination, ...path.split("/"));
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, content);
    }),
  );
  const directSkill = join(destination, "SKILL.md");
  if (await isFile(directSkill)) return destination;
  const entries = await readdir(destination, { withFileTypes: true });
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    const wrapped = join(destination, entries[0].name);
    if (await isFile(join(wrapped, "SKILL.md"))) return wrapped;
  }
  throw invalidArchive("Skill archive does not contain SKILL.md");
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function readOrigin(target: string): Promise<SkillOrigin | undefined> {
  try {
    const value = JSON.parse(
      await readFile(join(target, ".clawhub/origin.json"), "utf8"),
    ) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const origin = value as Record<string, unknown>;
    if (
      origin["version"] !== 1 ||
      typeof origin["fingerprint"] !== "string" ||
      typeof origin["installedVersion"] !== "string" ||
      typeof origin["ownerHandle"] !== "string" ||
      typeof origin["slug"] !== "string"
    ) {
      return undefined;
    }
    return origin as SkillOrigin;
  } catch {
    return undefined;
  }
}

async function collectSkillFiles(root: string, directory: string, files: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (directory === root && entry.name === ".clawhub") continue;
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw invalidArchive("Skill symlinks are not allowed");
    if (metadata.isDirectory()) {
      await collectSkillFiles(root, path, files);
    } else if (metadata.isFile()) {
      files.push(path);
    }
  }
}

export async function skillContentHash(root: string): Promise<string> {
  const files: string[] = [];
  await collectSkillFiles(root, root, files);
  files.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
  const combined = createHash("sha256");
  for (const [index, file] of files.entries()) {
    const content = await readFile(file);
    const path = relative(root, file).split(sep).join("/");
    const hash = createHash("sha256").update(content).digest("hex");
    if (index > 0) combined.update("\n");
    combined.update(path).update("\0").update(String(content.byteLength)).update("\0").update(hash);
  }
  return combined.digest("hex");
}

export async function installClawhubArchive(
  archive: DownloadedSkillArchive,
  skillsRoot: string,
  owner: string,
  slug: string,
  version: string,
): Promise<SkillInstallResult> {
  await mkdir(skillsRoot, { recursive: true });
  const target = join(skillsRoot, slug);
  const origin = await readOrigin(target);
  const targetExists = await stat(target).then(
    () => true,
    () => false,
  );
  if (
    targetExists &&
    (origin === undefined || origin.ownerHandle !== owner || origin.slug !== slug)
  ) {
    throw new SkillMarketError("SKILL_MARKET_CONFLICT", "Skill directory contains unrelated files");
  }
  if (
    targetExists &&
    origin !== undefined &&
    (await skillContentHash(target)) !== origin.fingerprint
  ) {
    throw new SkillMarketError("SKILL_MARKET_CONFLICT", "Skill directory contains local changes");
  }
  if (origin?.installedVersion === version) return { path: target, status: "current", version };

  const nonce = [String(process.pid), randomUUID()].join("-");
  const staging = join(skillsRoot, `.${slug}.codexly-${nonce}`);
  const backup = join(skillsRoot, `.${slug}.backup-${nonce}`);
  try {
    const extracted = await extractArchive(archive, staging);
    if (
      archive.contentHash !== null &&
      (await skillContentHash(extracted)) !== archive.contentHash
    ) {
      throw invalidArchive("Skill archive content hash does not match");
    }
    const source = await readFile(join(extracted, "SKILL.md"), "utf8");
    if (!isCodexCompatibleSkill(source)) {
      throw new SkillMarketError("SKILL_MARKET_INCOMPATIBLE", "Skill is not compatible with Codex");
    }
    const fingerprint = await skillContentHash(extracted);
    await mkdir(join(extracted, ".clawhub"), { recursive: true });
    await writeFile(
      join(extracted, ".clawhub/origin.json"),
      `${JSON.stringify(
        {
          fingerprint,
          installedVersion: version,
          ownerHandle: owner,
          registry: "https://clawhub.ai",
          slug,
          version: 1,
        } satisfies SkillOrigin,
        null,
        2,
      )}\n`,
    );
    if (targetExists) await rename(target, backup);
    try {
      await rename(extracted, target);
    } catch (error) {
      if (targetExists) await rename(backup, target).catch(() => undefined);
      throw error;
    }
    if (targetExists) await rm(backup, { force: true, recursive: true });
    if (extracted !== staging) await rm(staging, { force: true, recursive: true });
    return { path: target, status: targetExists ? "updated" : "installed", version };
  } catch (error) {
    await rm(staging, { force: true, recursive: true }).catch(() => undefined);
    if (error instanceof SkillMarketError) throw error;
    throw new SkillMarketError(
      "SKILL_MARKET_FILESYSTEM",
      `Skill installation failed for ${basename(target)}`,
    );
  }
}
