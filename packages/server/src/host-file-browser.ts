import type { Dirent } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import type { Readable } from "node:stream";

import {
  AGENT_FILE_EXTENSIONS,
  type AgentAttachmentMediaType,
  type HostFileKind,
  type HostFileListing,
} from "@code-agent/protocol";

import { classifyFilesystemEntries } from "./filesystem-entry-type.js";
import { listFilesystemRoots } from "./filesystem-roots.js";

const FILE_EXTENSIONS = new Set<string>(AGENT_FILE_EXTENSIONS);
const IMAGE_MEDIA_TYPES = new Map<string, AgentAttachmentMediaType>([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const FILE_MEDIA_TYPES = new Map<string, AgentAttachmentMediaType>([
  [".csv", "text/csv"],
  [".html", "text/html"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".xml", "text/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
]);

export type HostFileBrowserErrorReason = "file-unavailable" | "invalid-file" | "unsupported-file";

export class HostFileBrowserError extends Error {
  public constructor(
    message: string,
    public readonly reason: HostFileBrowserErrorReason,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HostFileBrowserError";
  }
}

export type HostAttachmentSource = Readonly<{
  content: Readable;
  kind: HostFileKind;
  mediaType: AgentAttachmentMediaType;
  name: string;
}>;

type HostFileBrowserOptions = Readonly<{
  filesystemRoots?: typeof listFilesystemRoots;
  homePath?: string;
  includeHidden?: boolean;
}>;

function toHostFileError(error: unknown): HostFileBrowserError {
  const code = (error as NodeJS.ErrnoException).code;
  const unavailable = code === "EACCES" || code === "EPERM";
  return new HostFileBrowserError(
    unavailable ? "Host file is not accessible" : "Host file path is invalid",
    unavailable ? "file-unavailable" : "invalid-file",
    { cause: error instanceof Error ? error : undefined },
  );
}

function mediaTypeFor(kind: HostFileKind, path: string): AgentAttachmentMediaType | undefined {
  const extension = extname(path).toLowerCase();
  if (kind === "image") {
    return IMAGE_MEDIA_TYPES.get(extension);
  }
  return FILE_EXTENSIONS.has(extension)
    ? (FILE_MEDIA_TYPES.get(extension) ?? "application/octet-stream")
    : undefined;
}

function compareEntries(
  left: HostFileListing["entries"][number],
  right: HostFileListing["entries"][number],
): number {
  if (left.type !== right.type) {
    return left.type === "directory" ? -1 : 1;
  }
  return (
    left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
    left.name.localeCompare(right.name, "en")
  );
}

async function resolveHostDirectory(
  requestedPath?: string,
  options: HostFileBrowserOptions = {},
): Promise<string> {
  const path = requestedPath ?? options.homePath ?? homedir();
  if (!isAbsolute(path)) {
    throw new HostFileBrowserError("Host directory path must be absolute", "invalid-file");
  }
  try {
    const requested = await lstat(path);
    if (requested.isSymbolicLink()) {
      throw new HostFileBrowserError("Host directory must not be a symbolic link", "invalid-file");
    }
    const normalizedPath = await realpath(path);
    if (!(await lstat(normalizedPath)).isDirectory()) {
      throw new HostFileBrowserError("Host path must identify a directory", "invalid-file");
    }
    return normalizedPath;
  } catch (error) {
    if (error instanceof HostFileBrowserError) {
      throw error;
    }
    throw toHostFileError(error);
  }
}

export async function readHostFileDirectory(
  kind: HostFileKind,
  requestedPath?: string,
  options: HostFileBrowserOptions = {},
): Promise<HostFileListing> {
  const [path, roots] = await Promise.all([
    resolveHostDirectory(requestedPath, options),
    (options.filesystemRoots ?? listFilesystemRoots)(),
  ]);
  let entries: HostFileListing["entries"];
  try {
    const children: Dirent[] = await readdir(path, { withFileTypes: true });
    const classifiedChildren = await classifyFilesystemEntries(
      path,
      children.filter((child) => options.includeHidden === true || !child.name.startsWith(".")),
    );
    entries = classifiedChildren
      .flatMap(({ entry, type }): HostFileListing["entries"] => {
        if (type === "directory") {
          return [{ name: entry.name, path: join(path, entry.name), type }];
        }
        if (type === "file" && mediaTypeFor(kind, join(path, entry.name)) !== undefined) {
          return [{ name: entry.name, path: join(path, entry.name), type }];
        }
        return [];
      })
      .sort(compareEntries);
  } catch (error) {
    throw toHostFileError(error);
  }

  const parentPath = dirname(path);
  return { entries, parentPath: parentPath === path ? null : parentPath, path, roots };
}

export async function resolveHostAttachment(
  kind: HostFileKind,
  requestedPath: string,
): Promise<HostAttachmentSource> {
  if (!isAbsolute(requestedPath)) {
    throw new HostFileBrowserError("Host file path must be absolute", "invalid-file");
  }
  const mediaType = mediaTypeFor(kind, requestedPath);
  if (mediaType === undefined) {
    throw new HostFileBrowserError("Host file type is unsupported", "unsupported-file");
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const requested = await lstat(requestedPath);
    if (requested.isSymbolicLink() || !requested.isFile()) {
      throw new HostFileBrowserError("Host path must identify a real file", "invalid-file");
    }
    const normalizedPath = await realpath(requestedPath);
    handle = await open(normalizedPath, "r");
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new HostFileBrowserError("Host path must identify a regular file", "invalid-file");
    }
    return {
      content: handle.createReadStream({ autoClose: true }),
      kind,
      mediaType,
      name: basename(normalizedPath),
    };
  } catch (error) {
    await handle?.close();
    if (error instanceof HostFileBrowserError) {
      throw error;
    }
    throw toHostFileError(error);
  }
}
