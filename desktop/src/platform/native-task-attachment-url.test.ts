import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol = "asset") => `${protocol}://localhost/${encodeURIComponent(path)}`,
}));
import { buildNativeTaskAttachmentUrl } from "./native-asset-url.js";

describe("native task attachment URL", () => {
  it("routes stable history identities through the scoped download protocol", () => {
    const url = new URL(buildNativeTaskAttachmentUrl("项目 空格", "task-1", "history-abc"));
    expect(url.protocol).toBe("task-attachment:");
    expect(url.searchParams.get("projectId")).toBe("项目 空格");
    expect(url.searchParams.get("taskId")).toBe("task-1");
    expect(url.searchParams.get("attachmentId")).toBe("history-abc");
  });
  it("preserves native Codex paths and optimistic blob previews", () => {
    expect(buildNativeTaskAttachmentUrl("p", "t", "/tmp/image.png")).toBe("asset://localhost/%2Ftmp%2Fimage.png");
    expect(buildNativeTaskAttachmentUrl("p", "t", "blob:preview")).toBe("blob:preview");
  });
});
