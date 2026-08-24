import { createReadStream } from "node:fs";
import { glob, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const EXPANDED_SKILL_PATTERN =
  /^<skill>\s*<name>(?<name>[^<]+)<\/name>\s*<path>(?<path>[^<]+)<\/path>[\s\S]*<\/skill>\s*$/u;
const LINKED_SKILL_PATTERN = /\[\$(?<name>[^\]\s]+)\]\((?<path>[^)]+\/SKILL\.md)\)/gu;
const SAFE_THREAD_ID_PATTERN = /^[a-zA-Z0-9_-]+$/u;
const TRANSCRIPT_DISCOVERY_INTERVAL_MS = 5_000;
const MAX_CACHED_THREADS = 256;
const MAX_CACHED_TURNS_PER_FILE = 2_048;
const MAX_CACHED_SKILL_NAME_BYTES_PER_FILE = 1024 * 1024;
const MAX_TRANSCRIPT_FILES_PER_THREAD = 8;
const MAX_TRANSCRIPT_BYTES_PER_READ = 8 * 1024 * 1024;
const MAX_TRANSCRIPT_LINE_BYTES = 1024 * 1024;

interface TranscriptFileCache {
  cachedSkillNameBytes: number;
  discardUntilNewline: boolean;
  mtimeMs: number;
  offset: number;
  pendingLine: Buffer;
  size: number;
  skillNamesByTurnId: Map<string, Set<string>>;
}

interface TranscriptThreadCache {
  files: Map<string, TranscriptFileCache>;
  lastDiscoveryAt: number;
  mergedSkills: ReadonlyMap<string, readonly string[]>;
  mergedSkillsDirty: boolean;
  pendingRead: Promise<ReadonlyMap<string, readonly string[]>> | undefined;
  transcriptPaths: string[];
}

const transcriptCacheByThread = new Map<string, TranscriptThreadCache>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractCodexTextSkills(value: string): Readonly<{
  skills: { name: string }[];
  text: string;
}> {
  const expandedSkill = EXPANDED_SKILL_PATTERN.exec(value);
  const expandedSkillName = expandedSkill?.groups?.["name"];
  const expandedSkillPath = expandedSkill?.groups?.["path"];
  if (expandedSkillName !== undefined && expandedSkillPath !== undefined) {
    // Codex 会把 Skill 展开为独立文本项；路径仅用于确认格式，不进入公开消息。
    return { skills: [{ name: expandedSkillName.trim() }], text: "" };
  }

  const skills: { name: string }[] = [];
  const text = value.replace(LINKED_SKILL_PATTERN, (...arguments_: unknown[]) => {
    const groups = arguments_.at(-1);
    if (isRecord(groups) && typeof groups["name"] === "string") {
      skills.push({ name: groups["name"] });
    }
    return "";
  });
  return { skills, text: text.trimStart() };
}

function collectTranscriptLineSkills(line: string, fileCache: TranscriptFileCache): void {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(entry) || entry["type"] !== "response_item") {
    return;
  }
  const payload = entry["payload"];
  if (!isRecord(payload) || payload["type"] !== "message" || payload["role"] !== "user") {
    return;
  }
  const metadata = payload["internal_chat_message_metadata_passthrough"];
  const turnId = isRecord(metadata) ? metadata["turn_id"] : undefined;
  if (typeof turnId !== "string" || !Array.isArray(payload["content"])) {
    return;
  }

  for (const contentPart of payload["content"]) {
    if (!isRecord(contentPart) || typeof contentPart["text"] !== "string") {
      continue;
    }
    const extracted = extractCodexTextSkills(contentPart["text"]);
    for (const skill of extracted.skills) {
      const skillNameBytes = Buffer.byteLength(skill.name);
      const existingNames = fileCache.skillNamesByTurnId.get(turnId);
      if (
        existingNames?.has(skill.name) === true ||
        skillNameBytes > MAX_CACHED_SKILL_NAME_BYTES_PER_FILE
      ) {
        continue;
      }
      // 同时约束条目数和实际名称字节；Map 插入顺序用于淘汰最早记录。
      while (
        (existingNames === undefined &&
          fileCache.skillNamesByTurnId.size >= MAX_CACHED_TURNS_PER_FILE) ||
        fileCache.cachedSkillNameBytes + skillNameBytes > MAX_CACHED_SKILL_NAME_BYTES_PER_FILE
      ) {
        const oldestTurnId = fileCache.skillNamesByTurnId.keys().next().value;
        if (oldestTurnId === undefined) {
          break;
        }
        const evictedNames = fileCache.skillNamesByTurnId.get(oldestTurnId);
        for (const evictedName of evictedNames ?? []) {
          fileCache.cachedSkillNameBytes -= Buffer.byteLength(evictedName);
        }
        fileCache.skillNamesByTurnId.delete(oldestTurnId);
      }
      const skillNames = fileCache.skillNamesByTurnId.get(turnId) ?? new Set<string>();
      skillNames.add(skill.name);
      fileCache.skillNamesByTurnId.delete(turnId);
      fileCache.skillNamesByTurnId.set(turnId, skillNames);
      fileCache.cachedSkillNameBytes += skillNameBytes;
    }
  }
}

function getTranscriptThreadCache(cacheKey: string): TranscriptThreadCache {
  const existing = transcriptCacheByThread.get(cacheKey);
  if (existing !== undefined) {
    // Map 的插入顺序充当轻量 LRU，避免长期运行时缓存只增不减。
    transcriptCacheByThread.delete(cacheKey);
    transcriptCacheByThread.set(cacheKey, existing);
    return existing;
  }

  const created: TranscriptThreadCache = {
    files: new Map(),
    lastDiscoveryAt: 0,
    mergedSkills: new Map(),
    mergedSkillsDirty: false,
    pendingRead: undefined,
    transcriptPaths: [],
  };
  transcriptCacheByThread.set(cacheKey, created);
  while (transcriptCacheByThread.size > MAX_CACHED_THREADS) {
    const oldestKey = transcriptCacheByThread.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    transcriptCacheByThread.delete(oldestKey);
  }
  return created;
}

async function discoverTranscriptPaths(
  cache: TranscriptThreadCache,
  transcriptPattern: string,
): Promise<void> {
  const now = Date.now();
  if (
    cache.transcriptPaths.length > 0 ||
    now - cache.lastDiscoveryAt < TRANSCRIPT_DISCOVERY_INTERVAL_MS
  ) {
    return;
  }

  const transcriptPaths: string[] = [];
  for await (const transcriptPath of glob(transcriptPattern)) {
    transcriptPaths.push(transcriptPath);
    if (transcriptPaths.length >= MAX_TRANSCRIPT_FILES_PER_THREAD) {
      break;
    }
  }
  cache.transcriptPaths = transcriptPaths;
  cache.lastDiscoveryAt = now;

  const discoveredPaths = new Set(transcriptPaths);
  for (const cachedPath of cache.files.keys()) {
    if (!discoveredPaths.has(cachedPath)) {
      cache.files.delete(cachedPath);
      cache.mergedSkillsDirty = true;
    }
  }
}

async function parseTranscriptFileIncrementally(
  transcriptPath: string,
  cache: TranscriptThreadCache,
  remainingBytes: number,
): Promise<number> {
  const transcriptStats = await stat(transcriptPath);
  const cachedFile = cache.files.get(transcriptPath);
  if (
    cachedFile?.mtimeMs === transcriptStats.mtimeMs &&
    cachedFile.size === transcriptStats.size &&
    cachedFile.offset === transcriptStats.size
  ) {
    return 0;
  }

  const canContinue =
    cachedFile !== undefined &&
    transcriptStats.size >= cachedFile.size &&
    transcriptStats.size >= cachedFile.offset &&
    (transcriptStats.size > cachedFile.size || transcriptStats.mtimeMs === cachedFile.mtimeMs);
  const fileCache: TranscriptFileCache = canContinue
    ? cachedFile
    : {
        cachedSkillNameBytes: 0,
        discardUntilNewline: false,
        mtimeMs: 0,
        offset: 0,
        pendingLine: Buffer.alloc(0),
        size: 0,
        skillNamesByTurnId: new Map(),
      };
  if (cachedFile !== undefined && fileCache !== cachedFile) {
    cache.mergedSkillsDirty = true;
  }
  const availableBytes = transcriptStats.size - fileCache.offset;
  const bytesToRead = Math.min(availableBytes, remainingBytes);
  if (bytesToRead <= 0) {
    fileCache.mtimeMs = transcriptStats.mtimeMs;
    fileCache.size = transcriptStats.size;
    cache.files.set(transcriptPath, fileCache);
    return 0;
  }

  const stream = createReadStream(transcriptPath, {
    end: fileCache.offset + bytesToRead - 1,
    start: fileCache.offset,
  });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const data =
      fileCache.pendingLine.length === 0 ? chunk : Buffer.concat([fileCache.pendingLine, chunk]);
    fileCache.pendingLine = Buffer.alloc(0);
    let lineStart = 0;
    let lineEnd = data.indexOf(0x0a, lineStart);
    while (lineEnd >= 0) {
      const line = data.subarray(lineStart, lineEnd);
      if (!fileCache.discardUntilNewline && line.length <= MAX_TRANSCRIPT_LINE_BYTES) {
        const contentEnd = line.at(-1) === 0x0d ? line.length - 1 : line.length;
        collectTranscriptLineSkills(line.subarray(0, contentEnd).toString("utf8"), fileCache);
      }
      fileCache.discardUntilNewline = false;
      lineStart = lineEnd + 1;
      lineEnd = data.indexOf(0x0a, lineStart);
    }
    const incompleteLine = data.subarray(lineStart);
    if (!fileCache.discardUntilNewline && incompleteLine.length <= MAX_TRANSCRIPT_LINE_BYTES) {
      fileCache.pendingLine = Buffer.from(incompleteLine);
    } else if (incompleteLine.length > 0) {
      fileCache.pendingLine = Buffer.alloc(0);
      fileCache.discardUntilNewline = true;
    }
  }

  // 半行单独有界缓存，文件 offset 始终前进，避免大行反复读取同一字节区间。
  fileCache.offset += bytesToRead;
  fileCache.mtimeMs = transcriptStats.mtimeMs;
  fileCache.size = transcriptStats.size;
  cache.files.set(transcriptPath, fileCache);
  cache.mergedSkillsDirty = true;
  return bytesToRead;
}

function mergeTranscriptSkills(
  cache: TranscriptThreadCache,
): ReadonlyMap<string, readonly string[]> {
  if (!cache.mergedSkillsDirty) {
    return cache.mergedSkills;
  }
  const merged = new Map<string, Set<string>>();
  for (const fileCache of cache.files.values()) {
    for (const [turnId, skillNames] of fileCache.skillNamesByTurnId) {
      const mergedNames = merged.get(turnId) ?? new Set<string>();
      for (const skillName of skillNames) {
        mergedNames.add(skillName);
      }
      merged.set(turnId, mergedNames);
    }
  }
  cache.mergedSkills = new Map(
    [...merged].map(([turnId, skillNames]) => [turnId, [...skillNames]]),
  );
  cache.mergedSkillsDirty = false;
  return cache.mergedSkills;
}

async function readCachedCodexTranscriptTurnSkills(
  cache: TranscriptThreadCache,
  transcriptPattern: string,
): Promise<ReadonlyMap<string, readonly string[]>> {
  try {
    await discoverTranscriptPaths(cache, transcriptPattern);
    let remainingBytes = MAX_TRANSCRIPT_BYTES_PER_READ;
    for (const transcriptPath of cache.transcriptPaths) {
      if (remainingBytes <= 0) {
        break;
      }
      try {
        remainingBytes -= await parseTranscriptFileIncrementally(
          transcriptPath,
          cache,
          remainingBytes,
        );
      } catch (error) {
        // 瞬时 stat/read 失败不应清空此前已恢复的 Skill。
        if (isRecord(error) && error["code"] === "ENOENT") {
          cache.files.delete(transcriptPath);
          cache.mergedSkillsDirty = true;
          cache.transcriptPaths = cache.transcriptPaths.filter((path) => path !== transcriptPath);
          cache.lastDiscoveryAt = 0;
        }
      }
    }
  } catch {
    // Transcript 恢复是补充信息，扫描失败时保留上次成功结果。
  }
  return mergeTranscriptSkills(cache);
}

export async function readCodexTranscriptTurnSkills(
  threadId: string,
  codexHome = process.env["CODEX_HOME"] ?? join(homedir(), ".codex"),
): Promise<ReadonlyMap<string, readonly string[]>> {
  if (!SAFE_THREAD_ID_PATTERN.test(threadId)) {
    return new Map();
  }

  const transcriptPattern = join(codexHome, "sessions", "**", `rollout-*-${threadId}.jsonl`);
  const cacheKey = `${codexHome}\0${threadId}`;
  const cache = getTranscriptThreadCache(cacheKey);
  if (cache.pendingRead !== undefined) {
    return cache.pendingRead;
  }

  const pendingRead = readCachedCodexTranscriptTurnSkills(cache, transcriptPattern);
  cache.pendingRead = pendingRead;
  try {
    return await pendingRead;
  } finally {
    if (cache.pendingRead === pendingRead) {
      cache.pendingRead = undefined;
    }
  }
}
