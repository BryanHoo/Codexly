import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CodexlyWorkbenchClient } from "../../projects/project-queries.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { ProjectSourcePanel } from "./project-source-panel.js";

vi.mock("../../access/access-context.js", () => ({ useIsLanAccess: () => true }));

describe("局域网未知格式预览兜底", () => {
  it("无法读取为文本时展示友好下载入口", async () => {
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    const readProjectSourceFile = vi
      .fn()
      .mockRejectedValue(new Error("Source file is unavailable"));
    await cache
      .fetchInfiniteQuery({
        initialPageParam: undefined,
        queryKey: ["projects", "project-1", null, "source-file", "model.custom"],
        queryFn: readProjectSourceFile,
      })
      .catch(() => undefined);
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={cache}>
        <TooltipProvider>
          <ProjectSourcePanel
            client={{ readProjectSourceFile } as unknown as CodexlyWorkbenchClient}
            previewKind="source"
            projectId="project-1"
            reference={{ path: "model.custom", lineNumber: null }}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain("请下载后使用系统应用打开");
    expect(markup).toContain('download="model.custom"');
    expect(markup).toContain("/v1/projects/project-1/files/download?path=model.custom");
    expect(markup).not.toContain('role="alert"');
    cache.clear();
  });
});
