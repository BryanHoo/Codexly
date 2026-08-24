import { describe, expect, it, vi } from "vitest";

import { classifyFilesystemEntry } from "./filesystem-entry-type.js";

type EntryMetadata = Readonly<{
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
}>;

function createMetadata(type: "directory" | "file" | "symbolic-link"): EntryMetadata {
  return {
    isDirectory: () => type === "directory",
    isFile: () => type === "file",
    isSymbolicLink: () => type === "symbolic-link",
  };
}

describe("classifyFilesystemEntry", () => {
  it("recognizes a Windows reparse point as a directory after lstat confirmation", async () => {
    const readMetadata = vi.fn(() => Promise.resolve(createMetadata("directory")));

    await expect(
      classifyFilesystemEntry(
        "C:\\Users\\test\\CloudDrive\\project\\src",
        createMetadata("symbolic-link"),
        readMetadata,
      ),
    ).resolves.toBe("directory");
    expect(readMetadata).toHaveBeenCalledOnce();
  });

  it("keeps a real symbolic link excluded after lstat confirmation", async () => {
    const readMetadata = vi.fn(() => Promise.resolve(createMetadata("symbolic-link")));

    await expect(
      classifyFilesystemEntry(
        "/workspace/project/linked",
        createMetadata("symbolic-link"),
        readMetadata,
      ),
    ).resolves.toBe("symbolic-link");
  });
});
