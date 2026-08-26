import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu } from "../../../shared/components/core/context-menu.js";
import { DropdownMenu } from "../../../shared/components/core/dropdown-menu.js";
import {
  getProjectFileManagerApp,
  getProjectOpenAppsForTarget,
  getProjectTargetAbsolutePath,
  ProjectOpenContextMenuItems,
  ProjectOpenDropdownMenuItems,
} from "./project-open-menu.js";
import {
  ProjectFileDeleteDialog,
  ProjectFileRenameDialog,
} from "./project-file-mutation-dialog.js";

describe("getProjectFileManagerApp", () => {
  it("selects only the system file manager for direct folder opening", () => {
    const apps = [
      { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
      { id: "finder", kind: "file-manager", name: "Finder" },
      { id: "terminal", kind: "terminal", name: "Terminal" },
    ] as const;

    expect(getProjectFileManagerApp(apps)?.id).toBe("finder");
    expect(getProjectFileManagerApp(apps.filter((app) => app.kind !== "file-manager"))).toBe(
      undefined,
    );
  });
});

describe("getProjectTargetAbsolutePath", () => {
  it("joins project-relative targets into native absolute paths", () => {
    expect(getProjectTargetAbsolutePath("/workspace/Codexly", "docs/guide.md")).toBe(
      "/workspace/Codexly/docs/guide.md",
    );
    expect(getProjectTargetAbsolutePath("C:\\workspace\\Codexly", "docs/guide.md")).toBe(
      "C:\\workspace\\Codexly\\docs\\guide.md",
    );
  });
});

describe("ProjectOpenContextMenuItems", () => {
  it("renders copy, open, and reference commands as one target menu", () => {
    const markup = renderToStaticMarkup(
      <ContextMenu open>
        <ProjectOpenContextMenuItems
          apps={[
            { id: "zed", kind: "editor", name: "Zed" },
            { id: "finder", kind: "file-manager", name: "Finder" },
          ]}
          isPending={false}
          onDelete={vi.fn()}
          onOpenInNewWindow={vi.fn()}
          onReference={vi.fn()}
          onRename={vi.fn()}
          onSelect={vi.fn()}
          target={{
            absolutePath: "/workspace/Codexly/README.md",
            path: "README.md",
            relativePath: "README.md",
            reference: {
              name: "README.md",
              path: "README.md",
              rootId: "root-codexly",
              rootPath: "/workspace/Codexly",
            },
            type: "file",
          }}
        />
      </ContextMenu>,
    );

    expect(markup).toContain('data-slot="context-menu-content"');
    expect(markup).toContain("复制名称");
    expect(markup).toContain("复制相对路径");
    expect(markup).toContain("复制绝对路径");
    expect(markup).not.toContain(">复制路径<");
    expect(markup).toContain("打开");
    expect(markup).toContain("在独立窗口打开");
    expect(markup).toContain("引用");
    expect(markup).toContain("重命名");
    expect(markup).toContain("删除");
    expect(markup.match(/data-slot="context-menu-sub-trigger"/gu)).toHaveLength(1);
    expect(markup.match(/data-slot="context-menu-item"/gu)).toHaveLength(7);
    expect(markup).not.toContain("menuitemradio");
    expect(markup).not.toContain("aria-checked");
  });

  it("removes the reference command for directory targets", () => {
    const markup = renderToStaticMarkup(
      <ContextMenu open>
        <ProjectOpenContextMenuItems
          apps={[{ id: "zed", kind: "editor", name: "Zed" }]}
          isPending={false}
          onDelete={vi.fn()}
          onOpenInNewWindow={vi.fn()}
          onReference={vi.fn()}
          onRename={vi.fn()}
          onSelect={vi.fn()}
          target={{
            absolutePath: "/workspace/Codexly/src",
            path: "src",
            relativePath: "src",
            type: "directory",
          }}
        />
      </ContextMenu>,
    );

    expect(markup).not.toContain("引用");
    expect(markup).not.toContain("在独立窗口打开");
    expect(markup).toContain("重命名");
    expect(markup).toContain("删除");
    expect(markup.match(/data-slot="context-menu-item"/gu)).toHaveLength(5);
  });

  it("warns that rename and delete confirmations change files on disk", () => {
    const renameMarkup = renderToStaticMarkup(
      <ProjectFileRenameDialog
        initialName="package.json"
        isPending={false}
        onClose={vi.fn()}
        onRename={vi.fn()}
        targetType="file"
      />,
    );
    const deleteMarkup = renderToStaticMarkup(
      <ProjectFileDeleteDialog
        isPending={false}
        name="docs"
        onClose={vi.fn()}
        onDelete={vi.fn()}
        targetType="directory"
      />,
    );

    expect(renameMarkup).toContain("将更改磁盘上的文件名称");
    expect(deleteMarkup).toContain("将删除磁盘上的目录及其内容");
  });

  it("offers the system default application only for file targets", () => {
    const apps = [
      { id: "zed", kind: "editor", name: "Zed" },
      { id: "system-default", kind: "system-default", name: "__SYSTEM_DEFAULT__" },
      { id: "finder", kind: "file-manager", name: "Finder" },
    ] as const;

    expect(getProjectOpenAppsForTarget(apps, "directory").map((app) => app.id)).toEqual([
      "zed",
      "finder",
    ]);
    expect(getProjectOpenAppsForTarget(apps, "file").map((app) => app.id)).toEqual([
      "zed",
      "system-default",
      "finder",
    ]);
  });
});

describe("ProjectOpenDropdownMenuItems", () => {
  it("keeps the standalone-window command in the file row actions menu", () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu open>
        <ProjectOpenDropdownMenuItems
          apps={[{ id: "zed", kind: "editor", name: "Zed" }]}
          isPending={false}
          onDelete={vi.fn()}
          onOpenInNewWindow={vi.fn()}
          onReference={vi.fn()}
          onRename={vi.fn()}
          onSelect={vi.fn()}
          target={{
            absolutePath: "/workspace/Codexly/README.md",
            path: "README.md",
            relativePath: "README.md",
            reference: {
              name: "README.md",
              path: "README.md",
              rootId: "root-codexly",
              rootPath: "/workspace/Codexly",
            },
            type: "file",
          }}
        />
      </DropdownMenu>,
    );

    expect(markup).toContain('data-slot="dropdown-menu-content"');
    expect(markup).toContain("在独立窗口打开");
  });
});
