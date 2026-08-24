import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu } from "../../../shared/components/core/context-menu.js";
import {
  getProjectFileManagerApp,
  getProjectOpenAppsForTarget,
  getProjectTargetAbsolutePath,
  ProjectOpenContextMenuItems,
} from "./project-open-menu.js";

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
          onReference={vi.fn()}
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
    expect(markup).toContain("引用");
    expect(markup.match(/data-slot="context-menu-sub-trigger"/gu)).toHaveLength(1);
    expect(markup.match(/data-slot="context-menu-item"/gu)).toHaveLength(4);
    expect(markup).not.toContain("menuitemradio");
    expect(markup).not.toContain("aria-checked");
  });

  it("removes the reference command for directory targets", () => {
    const markup = renderToStaticMarkup(
      <ContextMenu open>
        <ProjectOpenContextMenuItems
          apps={[{ id: "zed", kind: "editor", name: "Zed" }]}
          isPending={false}
          onReference={vi.fn()}
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
    expect(markup.match(/data-slot="context-menu-item"/gu)).toHaveLength(3);
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
