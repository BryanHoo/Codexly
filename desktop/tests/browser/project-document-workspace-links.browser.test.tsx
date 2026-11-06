import { useLayoutEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { useDocumentWorkspace } from "@codexly/ui/core/use-document-workspace";
import { WorkbenchDocumentWorkspace as DesktopWorkspace } from "../../src/features/workbench/components/workbench-document-workspace.js";
import { WorkbenchDocumentWorkspace as WebWorkspace } from "../../../apps/web/src/features/workbench/components/workbench-document-workspace.js";
import type { InspectorDocument } from "../../src/features/workbench/components/workbench-inspector-documents.js";
import { TooltipProvider } from "../../src/shared/components/core/tooltip.js";
import "../../src/shared/styles/globals.css";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-router")>(),
  useRouter: () => ({ history: { block: () => () => {} } }),
}));

const root = "/workspace/ld-framework";
const skillPath = `${root}/.agents/skills/lowcode-production-form/SKILL.md`;
// 使用用户文件中的实际链接结构，经过工作区、预览面板及真实 Markdown 渲染链。
const skill = "# 生产级低代码表单配置\n\n[平台契约](references/platform-contract.md)\n\n[WebMCP 工作流](references/webmcp.md)\n\n[物料表](references/materials.xlsx)";

describe.each([["桌面", DesktopWorkspace], ["Web", WebWorkspace]] as const)("%s 中间文档标签页链接", (_, Workspace) => {
  it("从 SKILL.md 打开参考文档并可继续跳转，非预览格式交给宿主", async () => {
    localStorage.setItem("codexly:workbench:markdown-preview:v1", JSON.stringify({ preview: true, version: 1 }));
    localStorage.setItem("codeagent:workbench:markdown-preview:v1", JSON.stringify({ preview: true, version: 1 }));
    const opened = vi.fn();
    const openProject = vi.fn().mockResolvedValue({});
    const client = {
      openProject,
      readProjectTextFile: vi.fn().mockImplementation((_project, _root, path: string) => Promise.resolve({
        path, version: "a".repeat(64),
        content: path === skillPath ? skill : "# 已打开平台契约\n\n[返回技能](../SKILL.md)",
      })),
    };
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Harness() {
      const workspace = useDocumentWorkspace<InspectorDocument>("project");
      const { open } = workspace;
      const openProjectFile = (path: string) => {
        opened(path);
        void open({ id: `source:${path}`, kind: "source", reference: { path, lineNumber: null } });
      };
      useLayoutEffect(() => { void open({ id: `source:${skillPath}`, kind: "source", reference: { path: skillPath, lineNumber: null } }); }, [open]);
      const context = { client, documentWorkspace: workspace, selectedRootPath: root, openProjectFile, removeInspectorDocument: workspace.close, openFileDiff: vi.fn() } as unknown as Parameters<typeof Workspace>[0]["context"];
      return <Workspace context={context} enabled projectId="project"><p>聊天正文</p></Workspace>;
    }
    const screen = await render(<QueryClientProvider client={cache}><TooltipProvider><div style={{ height: 700, width: 960 }}><Harness /></div></TooltipProvider></QueryClientProvider>);
    // 桌面偏好来自原生存储，直接操作真实预览按钮，不依赖浏览器 localStorage 模拟原生偏好。
    if (_ === "桌面") {
      await userEvent.click(screen.getByRole("button", { name: /预览 Markdown|Preview Markdown/ }));
    }
    await expect.poll(() => screen.container.querySelector(".file-markdown")?.textContent, { timeout: 5000 }).toContain("平台契约");
    await userEvent.click(screen.getByRole("link", { name: "物料表" }));
    expect(openProject).toHaveBeenCalledWith("project", root, { appId: "system-default", path: `${root}/.agents/skills/lowcode-production-form/references/materials.xlsx` });
    await userEvent.click(screen.getByRole("link", { name: "平台契约" }));
    await expect.poll(() => opened.mock.calls.at(-1)?.[0]).toBe(`${root}/.agents/skills/lowcode-production-form/references/platform-contract.md`);
    await expect.poll(() => screen.container.querySelector(".file-markdown")?.textContent).toContain("已打开平台契约");
    await userEvent.click(screen.getByRole("link", { name: "返回技能" }));
    await expect.poll(() => screen.container.querySelector(".file-markdown")?.textContent).toContain("生产级低代码表单配置");
    expect(opened).toHaveBeenLastCalledWith(skillPath);
    await screen.unmount();
    cache.clear();
    localStorage.removeItem("codexly:workbench:markdown-preview:v1");
    localStorage.removeItem("codeagent:workbench:markdown-preview:v1");
  });
});
