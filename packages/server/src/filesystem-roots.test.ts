import { describe, expect, it, vi } from "vitest";

import { listFilesystemRoots } from "./filesystem-roots.js";

describe("filesystem roots", () => {
  it("lists every available Windows drive in letter order", async () => {
    const accessPath = vi.fn((path: string) => {
      if (path !== "C:\\" && path !== "F:\\") {
        return Promise.reject(new Error("drive unavailable"));
      }
      return Promise.resolve();
    });

    await expect(listFilesystemRoots({ accessPath, platform: "win32" })).resolves.toEqual([
      { name: "C:", path: "C:\\" },
      { name: "F:", path: "F:\\" },
    ]);
    expect(accessPath).toHaveBeenCalledTimes(26);
  });

  it("does not invent filesystem roots on non-Windows hosts", async () => {
    const accessPath = vi.fn();

    await expect(listFilesystemRoots({ accessPath, platform: "darwin" })).resolves.toEqual([]);
    expect(accessPath).not.toHaveBeenCalled();
  });
});
