import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { PdfPreview } from "@codexly/ui/core/pdf-preview";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { NativeSourceFileClient } from "../../projects/project-query-contracts.js";
import { MessageFileAttachment } from "./message-file-attachment.js";
import { ProjectSourcePanel } from "./project-source-panel.js";

const labels = { open: "打开 PDF", unavailable: "当前环境不支持内嵌 PDF" };
const src = "data:application/pdf;base64,JVBERi0xLjcKJSVFT0Y=";

afterEach(() => {
  Reflect.deleteProperty(navigator, "pdfViewerEnabled");
});

it("聊天 PDF 仅在点击后挂载原生预览，关闭后释放 iframe", async () => {
  Object.defineProperty(navigator, "pdfViewerEnabled", { configurable: true, value: true });
  await i18n.changeLanguage("zh-CN");
  const screen = await render(
    <MessageFileAttachment
      attachment={{
        id: "/tmp/report.pdf",
        kind: "file",
        mediaType: "application/pdf",
        name: "报告.pdf",
        size: 8 * 1024 * 1024,
      }}
      url={src}
    />,
  );
  expect(document.querySelector("iframe")).toBeNull();
  await screen.getByRole("button", { name: "报告.pdf" }).click();
  await expect.poll(() => document.querySelector("iframe")?.getAttribute("src")).toBe(src);
  await screen.getByRole("button", { name: "关闭 PDF 预览" }).click();
  await expect.poll(() => document.querySelector("iframe")).toBeNull();
});

it("PDF 文件预览保留任务目录，避免调用源码和图片读取", async () => {
  Object.defineProperty(navigator, "pdfViewerEnabled", { configurable: true, value: true });
  const getProjectPdfFileUrl = vi.fn().mockResolvedValue(src);
  const readProjectSourceFile = vi.fn();
  const cacheProjectImage = vi.fn();
  const client = {
    getProjectPdfFileUrl,
    readProjectSourceFile,
    cacheProjectImage,
    openProject: vi.fn(),
  } as unknown as NativeSourceFileClient;
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={cache}>
      <TooltipProvider>
        <ProjectSourcePanel
          client={client}
          previewKind="pdf"
          projectId="project"
          rootPath="/worktree"
          taskId="task"
          reference={{ path: "报告.PDF", lineNumber: null }}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await expect.poll(() => document.querySelector("iframe")?.getAttribute("src")).toBe(src);
  expect(document.querySelector("[data-pdf-preview]")?.textContent).not.toContain(labels.open);
  expect(getProjectPdfFileUrl).toHaveBeenCalledWith("project", "/worktree", "报告.PDF", {
    taskId: "task",
  });
  expect(readProjectSourceFile).not.toHaveBeenCalled();
  expect(cacheProjectImage).not.toHaveBeenCalled();
  cache.clear();
});

it("不支持内嵌 PDF 时保留明确提示和打开动作", async () => {
  Object.defineProperty(navigator, "pdfViewerEnabled", { configurable: true, value: false });
  const onOpen = vi.fn();
  const screen = await render(
    <PdfPreview name="报告.pdf" src={src} labels={labels} onOpen={onOpen} />,
  );
  await expect.element(screen.getByRole("status")).toHaveTextContent(labels.unavailable);
  expect(document.querySelector("iframe")).toBeNull();
  await screen.getByRole("button", { name: labels.open }).click();
  expect(onOpen).toHaveBeenCalledOnce();
});
