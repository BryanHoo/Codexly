import { describe, expect, it } from "vitest";

import { rewriteTemporaryTaskUrl } from "./temporary-task-routing.js";

describe("rewriteTemporaryTaskUrl", () => {
  it.each([
    [
      "/v1/temporary/files/source?path=%2Ftmp%2Fnotes.md",
      "/v1/projects/temporary/files/source?path=%2Ftmp%2Fnotes.md",
    ],
    [
      "/v1/temporary/files/image?path=%2Ftmp%2Fresult.png",
      "/v1/projects/temporary/files/image?path=%2Ftmp%2Fresult.png",
    ],
    ["/v1/temporary/open-capabilities", "/v1/projects/temporary/open-capabilities"],
    ["/v1/temporary/open", "/v1/projects/temporary/open"],
  ])("forwards the temporary common file route %s", (publicUrl, internalUrl) => {
    expect(rewriteTemporaryTaskUrl(publicUrl)).toBe(internalUrl);
  });
});
