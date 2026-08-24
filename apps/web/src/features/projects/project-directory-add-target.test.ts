import { describe, expect, it } from "vitest";

import { resolveProjectDirectoryAddPaths } from "./project-directory-add-target.js";

describe("resolveProjectDirectoryAddPaths", () => {
  it("returns one normalized path after the submitted path is validated", () => {
    expect(
      resolveProjectDirectoryAddPaths({
        draftPath: undefined,
        isPathValidated: true,
        requestedPath: "/workspace/link",
        selectedPaths: [],
        submittedPath: "/workspace/link",
        validatedPath: "/workspace/project",
      }),
    ).toEqual(["/workspace/project"]);
  });

  it("keeps ordered checkbox selections separate from direct path input", () => {
    expect(
      resolveProjectDirectoryAddPaths({
        draftPath: undefined,
        isPathValidated: true,
        requestedPath: "/workspace/direct",
        selectedPaths: ["/workspace/primary", "/workspace/secondary"],
        submittedPath: "/workspace/direct",
        validatedPath: "/workspace/direct",
      }),
    ).toEqual(["/workspace/primary", "/workspace/secondary"]);
  });

  it.each([
    {
      draftPath: undefined,
      isPathValidated: false,
      requestedPath: "/workspace/project",
    },
    {
      draftPath: "/workspace/edited",
      isPathValidated: true,
      requestedPath: "/workspace/project",
    },
    {
      draftPath: undefined,
      isPathValidated: true,
      requestedPath: "/workspace/other",
    },
  ])("rejects an incomplete or stale direct path state: %o", (override) => {
    expect(
      resolveProjectDirectoryAddPaths({
        selectedPaths: [],
        submittedPath: "/workspace/project",
        validatedPath: "/workspace/project",
        ...override,
      }),
    ).toEqual([]);
  });
});
