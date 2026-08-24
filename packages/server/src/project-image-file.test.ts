import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readProjectImageFile } from "./project-image-file.js";

const temporaryPaths: string[] = [];
const pngContent = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("readProjectImageFile", () => {
  it("reads a supported image from an absolute Project file reference", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "code-agent-image-"));
    temporaryPaths.push(projectRoot);
    const imagePath = join(projectRoot, "result.png");
    await writeFile(imagePath, pngContent);
    const resolvedImagePath = await realpath(imagePath);

    await expect(readProjectImageFile(projectRoot, imagePath)).resolves.toEqual({
      content: pngContent,
      mediaType: "image/png",
      path: resolvedImagePath,
    });
  });

  it("reads a supported image from an absolute path outside the project root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "code-agent-image-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "code-agent-image-outside-"));
    temporaryPaths.push(projectRoot, outsideRoot);
    const imagePath = join(outsideRoot, "result.png");
    await writeFile(imagePath, pngContent);
    const resolvedImagePath = await realpath(imagePath);

    await expect(readProjectImageFile(projectRoot, imagePath)).resolves.toEqual({
      content: pngContent,
      mediaType: "image/png",
      path: resolvedImagePath,
    });
  });

  it("rejects invalid signatures and symbolic links", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "code-agent-image-secure-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "code-agent-image-outside-"));
    temporaryPaths.push(projectRoot, outsideRoot);
    const invalidImagePath = join(projectRoot, "invalid.png");
    const outsideImagePath = join(outsideRoot, "outside.png");
    await writeFile(invalidImagePath, "not an image");
    await writeFile(outsideImagePath, pngContent);
    await symlink(outsideImagePath, join(projectRoot, "linked.png"));

    await expect(readProjectImageFile(projectRoot, invalidImagePath)).rejects.toThrow(
      "Unsupported project image file",
    );
    await expect(readProjectImageFile(projectRoot, "linked.png")).rejects.toThrow(
      "outside the project root",
    );
  });
});
