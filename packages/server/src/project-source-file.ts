import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ProjectSourceFile } from "@codexly/protocol";

export const MAX_SOURCE_FILE_PREVIEW_BYTES = 256 * 1_024;
export const MAX_SOURCE_FILE_PREVIEW_LINES = 4_000;
const MAX_UTF8_CODE_POINT_BYTES = 4;

function isOutsideProject(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

export async function readProjectSourceFile(
  projectRoot: string,
  requestedPath: string,
  cursor = 0,
): Promise<ProjectSourceFile> {
  if (
    !isAbsolute(projectRoot) ||
    requestedPath.length === 0 ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0
  ) {
    throw new TypeError("Project root and source path must be valid");
  }

  const resolvedProjectRoot = await realpath(projectRoot);
  const isAbsoluteReference = isAbsolute(requestedPath);
  const candidatePath = isAbsoluteReference
    ? requestedPath
    : resolve(resolvedProjectRoot, requestedPath);
  const resolvedSourcePath = await realpath(candidatePath);
  const projectRelativePath = relative(resolvedProjectRoot, resolvedSourcePath);
  // 显式绝对路径来自 AI 文件引用，可以指向本机任意可读文件；相对路径仍受 Project 约束。
  if (!isAbsoluteReference && isOutsideProject(projectRelativePath)) {
    throw new TypeError("Source file is outside the project root");
  }

  const sourceStats = await stat(resolvedSourcePath);
  if (!sourceStats.isFile()) {
    throw new TypeError("Source path is not a regular file");
  }
  if (cursor > sourceStats.size) {
    throw new TypeError("Source cursor is outside the file");
  }

  const previewByteLength = Math.min(sourceStats.size - cursor, MAX_SOURCE_FILE_PREVIEW_BYTES);
  const previewBuffer = Buffer.alloc(previewByteLength);
  const sourceFileHandle = await open(resolvedSourcePath, "r");
  try {
    let totalBytesRead = 0;
    while (totalBytesRead < previewByteLength) {
      const { bytesRead } = await sourceFileHandle.read(
        previewBuffer,
        totalBytesRead,
        previewByteLength - totalBytesRead,
        cursor + totalBytesRead,
      );
      if (bytesRead === 0) break;
      totalBytesRead += bytesRead;
    }
    if (totalBytesRead !== previewByteLength) {
      throw new TypeError("Source file changed while it was being read");
    }
  } finally {
    await sourceFileHandle.close();
  }
  if (previewBuffer.includes(0)) {
    throw new TypeError("Binary source files cannot be previewed");
  }

  let pageByteLength = previewBuffer.length;
  let lineCount = 0;
  for (let byteIndex = 0; byteIndex < previewBuffer.length; byteIndex += 1) {
    if (previewBuffer[byteIndex] !== 0x0a) continue;
    lineCount += 1;
    if (lineCount === MAX_SOURCE_FILE_PREVIEW_LINES) {
      // 保留分页边界处的换行符，后续页面拼接时不会丢失源文件内容。
      pageByteLength = byteIndex + 1;
      break;
    }
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let decodedContent: string | undefined;
  // 字节上限可能落在多字节字符中间，最多回退三个字节即可找到完整 UTF-8 边界。
  const minimumPageByteLength = Math.max(0, pageByteLength - (MAX_UTF8_CODE_POINT_BYTES - 1));
  for (
    let candidateByteLength = pageByteLength;
    candidateByteLength >= minimumPageByteLength;
    candidateByteLength -= 1
  ) {
    try {
      decodedContent = decoder.decode(previewBuffer.subarray(0, candidateByteLength));
      pageByteLength = candidateByteLength;
      break;
    } catch {
      // 继续回退；若四种边界都无效，则文件不是有效 UTF-8 文本。
    }
  }
  if (decodedContent === undefined || (pageByteLength === 0 && previewBuffer.length > 0)) {
    throw new TypeError("Source file is not valid UTF-8 text");
  }

  const nextByteOffset = cursor + pageByteLength;

  return {
    content: decodedContent,
    nextCursor: nextByteOffset < sourceStats.size ? nextByteOffset : null,
    path: isAbsoluteReference ? resolvedSourcePath : projectRelativePath.split(sep).join("/"),
  };
}
