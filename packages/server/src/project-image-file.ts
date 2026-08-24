import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const MAX_PROJECT_IMAGE_PREVIEW_BYTES = 20 * 1_024 * 1_024;

export type ProjectImageFile = Readonly<{
  content: Buffer;
  mediaType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
  path: string;
}>;

function isOutsideProject(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

function detectImageMediaType(content: Buffer): ProjectImageFile["mediaType"] | null {
  if (
    content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return "image/jpeg";
  }
  if (/^GIF8[79]a$/u.test(content.subarray(0, 6).toString("ascii"))) {
    return "image/gif";
  }
  if (
    content.subarray(0, 4).toString("ascii") === "RIFF" &&
    content.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function readProjectImageFile(
  projectRoot: string,
  requestedPath: string,
): Promise<ProjectImageFile> {
  if (!isAbsolute(projectRoot) || requestedPath.length === 0) {
    throw new TypeError("Project root and image path must be valid");
  }

  const resolvedProjectRoot = await realpath(projectRoot);
  const isAbsoluteReference = isAbsolute(requestedPath);
  const candidatePath = isAbsoluteReference
    ? requestedPath
    : resolve(resolvedProjectRoot, requestedPath);
  const projectRelativePath = relative(resolvedProjectRoot, candidatePath);
  if (
    !isAbsoluteReference &&
    (projectRelativePath.length === 0 || isOutsideProject(projectRelativePath))
  ) {
    throw new TypeError("Project image file is outside the project root");
  }

  if (!isAbsoluteReference) {
    let currentPath = resolvedProjectRoot;
    // Project 相对路径逐段拒绝符号链接，避免普通文件树路径逃逸。
    for (const segment of projectRelativePath.split(sep)) {
      currentPath = resolve(currentPath, segment);
      if ((await lstat(currentPath)).isSymbolicLink()) {
        throw new TypeError("Project image file is outside the project root");
      }
    }
  }

  const resolvedImagePath = await realpath(candidatePath);
  if (!isAbsoluteReference && isOutsideProject(relative(resolvedProjectRoot, resolvedImagePath))) {
    throw new TypeError("Project image file is outside the project root");
  }
  const imageStats = await stat(resolvedImagePath);
  if (
    !imageStats.isFile() ||
    imageStats.size === 0 ||
    imageStats.size > MAX_PROJECT_IMAGE_PREVIEW_BYTES
  ) {
    throw new TypeError("Unsupported project image file");
  }

  const content = await readFile(resolvedImagePath);
  const mediaType = detectImageMediaType(content);
  if (mediaType === null) {
    throw new TypeError("Unsupported project image file");
  }
  return {
    content,
    mediaType,
    path: isAbsoluteReference
      ? resolvedImagePath
      : relative(resolvedProjectRoot, resolvedImagePath).split(sep).join("/"),
  };
}
