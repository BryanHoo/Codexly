import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { MessageResponse } from "./message-response.js";
import { TimelineImageProvider } from "../../../features/workbench/components/timeline-image-provider.js";
import { CodexlyClient } from "@codexly/client";
import {
  ProjectDataContext,
  ProjectRootSelectionContext,
} from "../../../features/projects/project-context-state.js";

describe("聊天生成图片", () => {
  it.each([
    [undefined, "%2Fworkspace%2Fother"],
    ["/worktrees/task-a", "%2Fworktrees%2Ftask-a"],
  ])("按任务绑定目录或所属项目根选择读取图片 %s", (rootPath, expectedRoot) => {
    const markup = renderToStaticMarkup(
      <ProjectDataContext.Provider
        value={{
          client: new CodexlyClient(),
          capabilities: undefined,
          error: null,
          isPending: false,
          projectTaskStates: new Map(),
          tasks: [],
          projects: [
            {
              createdAt: "2026-10-10T00:00:00.000Z",
              id: "better-day",
              name: "Better Day",
              roots: [
                { id: "main", path: "/workspace/main" },
                { id: "other", path: "/workspace/other" },
              ],
            },
          ],
        }}
      >
        <ProjectRootSelectionContext.Provider
          value={{
            selectedRootIds: new Map([["better-day", "other"]]),
            setSelectedProjectRoot: vi.fn(),
          }}
        >
          <TimelineImageProvider projectId="better-day" rootPath={rootPath}>
            <MessageResponse mode="static">{"![预览](./outputs/preview.png)"}</MessageResponse>
          </TimelineImageProvider>
        </ProjectRootSelectionContext.Provider>
      </ProjectDataContext.Provider>,
    );
    expect(markup).toContain(`rootPath=${expectedRoot}`);
  });
  it("缺少任务文件上下文时显示本地化提示，保留远程图片 URL", () => {
    const markup = renderToStaticMarkup(
      <MessageResponse mode="static">
        {"![本地预览](./missing.png)\n\n![远程图片](https://example.com/image.png)"}
      </MessageResponse>,
    );
    expect(markup).toContain("附件读取失败：本地预览");
    expect(markup).not.toContain("/__codexly_relative__/");
    expect(markup).toContain('src="https://example.com/image.png"');
  });
  it("历史回放按所属任务 worktree 读取相对图片", () => {
    const markup = renderToStaticMarkup(
      <TimelineImageProvider projectId="better-day" rootPath="/worktrees/task-a">
        <MessageResponse mode="static">{"![预览](./outputs/preview.png)"}</MessageResponse>
      </TimelineImageProvider>,
    );
    expect(markup).toContain(
      "/v1/projects/better-day/files/image?path=outputs%2Fpreview.png&amp;rootPath=%2Fworktrees%2Ftask-a",
    );
  });
  it.each(["static", "streaming"] as const)("在 %s 回复中读取任务图片而非网页相对地址", (mode) => {
    const source = "![新旧图标对比](./outputs/icon-designs/comparison.png)";
    const resolveImage = vi.fn(() => "/v1/projects/better-day/files/image?path=comparison.png");
    const imageProps = { resolveImage };
    const markup = renderToStaticMarkup(
      <MessageResponse
        {...imageProps}
        mode={mode}
        {...(mode === "streaming"
          ? { textSource: new AppendOnlyTextBuffer(source).getSnapshot(), isAnimating: false }
          : {})}
      >
        {source}
      </MessageResponse>,
    );
    expect(resolveImage).toHaveBeenCalledWith("outputs/icon-designs/comparison.png");
    expect(markup).toContain('src="/v1/projects/better-day/files/image?path=comparison.png"');
    expect(markup).not.toContain("/__codexly_relative__/");
  });
});
