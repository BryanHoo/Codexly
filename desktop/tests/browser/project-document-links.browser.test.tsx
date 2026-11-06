import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { ProjectDocumentLinksContext } from "@codexly/ui/core/project-document-links";
import { MessageResponse as DesktopResponse } from "../../src/shared/components/agent/message-response.js";
import { MessageResponse as WebResponse } from "../../../apps/web/src/shared/components/agent/message-response.js";

// 使用两端真实 Markdown 解析链，防止路径被清洗成内部占位 URL 后失去文件目录。
describe.each([["桌面", DesktopResponse], ["Web", WebResponse]] as const)("%s 文件链接", (_, Response) => {
  it.each([360, 960])("以当前文件目录打开链接并保留显示文字（%s px）", async (width) => {
    await page.viewport(width, 800);
    const openFile = vi.fn();
    const screen = await render(
      <ProjectDocumentLinksContext.Provider value={{ sourcePath: "/repo/docs/README.md", openFile }}>
        <div className="file-markdown">
          <Response mode="static">{"[平台契约](./guide.md)\n\n[图片](../assets/a%20b.png)\n\n[表格](./data.xlsx)\n\n[绝对路径](/repo/LICENSE)\n\n[文件 URI](file:///repo/hello.txt)"}</Response>
        </div>
      </ProjectDocumentLinksContext.Provider>,
    );
    for (const [label, path] of [["平台契约", "/repo/docs/guide.md"], ["图片", "/repo/assets/a b.png"], ["表格", "/repo/docs/data.xlsx"], ["绝对路径", "/repo/LICENSE"], ["文件 URI", "/repo/hello.txt"]]) {
      await userEvent.click(screen.getByRole("link", { name: label }));
      expect(openFile).toHaveBeenLastCalledWith({ path, lineNumber: null });
    }
  });
});
