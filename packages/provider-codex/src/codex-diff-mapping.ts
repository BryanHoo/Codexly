import { Buffer } from "node:buffer";

import { MAX_REALTIME_DIFF_BYTES, MAX_REALTIME_FILE_CHANGES } from "@codexly/protocol";

import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-mapping-common.js";
import { mapFileChangeKind } from "./codex-tool-mapping.js";

type MappedCodexFileChange = Readonly<{
  diff: string;
  kind: "create" | "delete" | "update";
  path: string;
}>;

function splitCodexFileContent(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

function normalizeCodexFileDiff(change: MappedCodexFileChange): string {
  if (change.kind === "update") return change.diff;

  const path = change.path.replace(/^[/\\]+/u, "").replaceAll("\\", "/");
  const lines = splitCodexFileContent(change.diff);
  const marker = change.kind === "create" ? "+" : "-";
  const deletionPath = change.kind === "create" ? "/dev/null" : `a/${path}`;
  const additionPath = change.kind === "delete" ? "/dev/null" : `b/${path}`;
  const range =
    change.kind === "create"
      ? `-0,0 +1,${String(lines.length)}`
      : `-1,${String(lines.length)} +0,0`;

  // App Server 对 Add/Delete 只提供原始内容，在 Provider 边界合成为统一 Diff 契约。
  return [
    `--- ${deletionPath}`,
    `+++ ${additionPath}`,
    `@@ ${range} @@`,
    ...lines.map((line) => `${marker}${line}`),
  ].join("\n");
}

export function mapCodexFileChange(value: unknown): MappedCodexFileChange {
  const change = expectRecord(value, "Codex file change");
  const mapped = {
    diff: expectString(change["diff"], "Codex file change diff"),
    kind: mapFileChangeKind(change["kind"]),
    path: expectString(change["path"], "Codex file change path"),
  };
  return { ...mapped, diff: normalizeCodexFileDiff(mapped) };
}

export function boundRealtimeDiff(diff: string, maxBytes = MAX_REALTIME_DIFF_BYTES) {
  const originalByteLength = Buffer.byteLength(diff, "utf8");
  if (originalByteLength <= maxBytes) {
    return { diff, originalByteLength, truncated: false };
  }

  let sourceEnd = Math.min(diff.length, maxBytes);
  const trailingCodeUnit = diff.charCodeAt(sourceEnd - 1);
  if (
    trailingCodeUnit >= 0xd800 &&
    trailingCodeUnit <= 0xdbff &&
    diff.charCodeAt(sourceEnd) >= 0xdc00 &&
    diff.charCodeAt(sourceEnd) <= 0xdfff
  ) {
    sourceEnd -= 1;
  }
  // UTF-8 字节数不会少于 UTF-16 code unit 数，先限制源前缀可避免复制完整超大 diff。
  const encoded = Buffer.from(diff.slice(0, sourceEnd), "utf8");
  let end = Math.min(encoded.length, maxBytes);
  // 回退到当前 UTF-8 字符的起始位置，避免生成包含替换字符的半截文本。
  while (end > 0 && ((encoded[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }
  return {
    diff: encoded.subarray(0, end).toString("utf8"),
    originalByteLength,
    truncated: true,
  };
}

export function mapRealtimeFileChanges(value: unknown) {
  if (!Array.isArray(value)) {
    throw new CodexProtocolMappingError("Codex file change update must be an array");
  }
  const changes: {
    diff: string;
    kind: "create" | "delete" | "update";
    path: string;
  }[] = [];
  let originalByteLength = 0;
  let remainingBytes = MAX_REALTIME_DIFF_BYTES;
  let truncated = value.length > MAX_REALTIME_FILE_CHANGES;

  for (const [index, entry] of value.entries()) {
    const { diff, kind, path } = mapCodexFileChange(entry);
    if (index >= MAX_REALTIME_FILE_CHANGES) {
      originalByteLength += Buffer.byteLength(diff, "utf8");
      continue;
    }
    const bounded = boundRealtimeDiff(diff, remainingBytes);
    originalByteLength += bounded.originalByteLength;
    changes.push({ diff: bounded.diff, kind, path });
    remainingBytes -= Buffer.byteLength(bounded.diff, "utf8");
    truncated ||= bounded.truncated;
  }

  return { changes, originalByteLength, truncated };
}
