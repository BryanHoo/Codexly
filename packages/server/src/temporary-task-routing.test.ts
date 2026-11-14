import { describe, expect, it } from "vitest";

import { rewriteTemporaryTaskUrl } from "./temporary-task-routing.js";

describe("rewriteTemporaryTaskUrl", () => {
  it.each([
    ["/v1/temporary/submissions", "/v1/projects/temporary/submissions"],
    [
      "/v1/temporary/files/source?path=%2Ftmp%2Fnotes.md",
      "/v1/projects/temporary/files/source?path=%2Ftmp%2Fnotes.md",
    ],
    [
      "/v1/temporary/files/image?path=%2Ftmp%2Fresult.png",
      "/v1/projects/temporary/files/image?path=%2Ftmp%2Fresult.png",
    ],
    [
      "/v1/temporary/files/download?path=%2Ftmp%2Fresult.txt",
      "/v1/projects/temporary/files/download?path=%2Ftmp%2Fresult.txt",
    ],
    ["/v1/temporary/open-capabilities", "/v1/projects/temporary/open-capabilities"],
    ["/v1/temporary/open", "/v1/projects/temporary/open"],
  ])("forwards the temporary common file route %s", (publicUrl, internalUrl) => {
    expect(rewriteTemporaryTaskUrl(publicUrl)).toBe(internalUrl);
  });
});

it("聊天模型预览复用项目 ACP 路由，保留 Agent 和查询参数", () => {
  expect(rewriteTemporaryTaskUrl("/v1/temporary/acp/codex/preview")).toBe(
    "/v1/projects/temporary/acp/codex/preview",
  );
  expect(rewriteTemporaryTaskUrl("/v1/temporary/acp/claude/preview?x=1")).toBe(
    "/v1/projects/temporary/acp/claude/preview?x=1",
  );
  expect(rewriteTemporaryTaskUrl("/v1/temporary/acp/unknown/preview")).toBe(
    "/v1/temporary/acp/unknown/preview",
  );
});
