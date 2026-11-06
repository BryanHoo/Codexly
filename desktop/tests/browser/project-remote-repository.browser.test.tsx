import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ProjectQuickOpenMenu as WebQuick,
  ProjectOpenContextMenuItems as WebContext,
  ProjectOpenDropdownMenuItems as WebDropdown,
} from "../../../apps/web/src/features/workbench/components/project-open-menu.js";
import {
  ProjectQuickOpenMenu as DesktopQuick,
  ProjectOpenContextMenuItems as DesktopContext,
  ProjectOpenDropdownMenuItems as DesktopDropdown,
} from "../../src/features/workbench/components/project-open-menu.js";
import { ContextMenu, ContextMenuTrigger } from "@codexly/ui/core/context-menu";
import { DropdownMenu, DropdownMenuTrigger } from "@codexly/ui/core/dropdown-menu";
import "../../src/shared/styles/globals.css";

const mocks = vi.hoisted(() => ({
  getProjectGitStatus: vi.fn(),
  pushProjectCommits: vi.fn(),
  openExternalUrl: vi.fn(),
}));
vi.mock("../../../apps/web/src/features/projects/project-query-contracts.js", () => ({
  codexlyClient: mocks,
}));
vi.mock("../../src/features/projects/project-query-contracts.js", () => ({ nativeClient: mocks }));
vi.mock("../../src/platform/tauri/external-url.js", () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

async function assertWebLink(item: ReturnType<typeof page.getByRole>) {
  await expect.element(item).toHaveAttribute("href", "https://github.com/team/repo");
  await expect.element(item).toHaveAttribute("target", "_blank");
}
async function assertDesktopOpen(item: ReturnType<typeof page.getByRole>) {
  await item.click();
  expect(mocks.openExternalUrl).toHaveBeenCalledWith("https://github.com/team/repo");
}
async function assertNoRepository(item: ReturnType<typeof page.getByRole>) {
  await expect.element(item).not.toBeInTheDocument();
  expect(mocks.pushProjectCommits).not.toHaveBeenCalled();
}
async function assertNoRemote(item: ReturnType<typeof page.getByRole>) {
  await expect.element(item).toHaveAttribute("data-disabled");
}

describe.each([
  ["web", WebQuick, WebContext, WebDropdown],
  ["desktop", DesktopQuick, DesktopContext, DesktopDropdown],
] as const)("%s 远程仓库入口", (platform, Quick, ContextItems, DropdownItems) => {
  it.each(["quick", "context", "dropdown"] as const)(
    "%s 菜单转换 SSH 地址并打开",
    async (entry) => {
      const cache = new QueryClient();
      const target = { projectId: "remote-project", rootPath: "/repo" };
      cache.setQueryData(["projects", target.projectId, target.rootPath, "git-status"], {
        repositoryMode: "root",
        branch: "main",
        snapshot: "a".repeat(64),
      });
      mocks.pushProjectCommits.mockResolvedValue({
        remoteState: {
          remote: "origin",
          remotes: [{ name: "origin", url: "git@github.com:team/repo.git" }],
        },
      });
      mocks.openExternalUrl.mockResolvedValue(undefined);
      mocks.pushProjectCommits.mockClear();
      const props = {
        apps: [],
        isPending: false,
        onSelect: vi.fn(),
        onReference: vi.fn(),
        remote: target,
        target: {
          absolutePath: "/repo",
          path: "/repo",
          relativePath: ".",
          type: "directory" as const,
        },
      };
      const screen = await render(
        <QueryClientProvider client={cache}>
          {entry === "quick" ? (
            <Quick {...props} isDetecting={false} />
          ) : entry === "context" ? (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button>根菜单</button>
              </ContextMenuTrigger>
              <ContextItems {...props} />
            </ContextMenu>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button>根菜单</button>
              </DropdownMenuTrigger>
              <DropdownItems {...props} />
            </DropdownMenu>
          )}
        </QueryClientProvider>,
      );
      expect(mocks.pushProjectCommits).not.toHaveBeenCalled();
      if (entry === "quick") {
        await screen.getByRole("button", { name: /选择打开方式|Choose how to open/u }).click();
      }
      if (entry !== "quick")
        await screen
          .getByRole("button", { name: "根菜单" })
          .click({ button: entry === "context" ? "right" : "left" });
      const item = page.getByRole("menuitem", { name: /打开远程仓库|Open remote repository/u });
      await expect.element(item).toBeEnabled();
      expect(mocks.pushProjectCommits).toHaveBeenCalledWith(target.projectId, target.rootPath, {
        action: "inspect",
        expectedSnapshot: "a".repeat(64),
      });
      await (platform === "web" ? assertWebLink : assertDesktopOpen)(item);
      await screen.unmount();
      cache.clear();
    },
  );
  it.each(["none", "children", "root"])(
    "仓库模式 %s 正确控制显隐和无远端禁用",
    async (repositoryMode) => {
      const cache = new QueryClient();
      const target = { projectId: "plain", rootPath: "/plain" };
      cache.setQueryData(["projects", target.projectId, target.rootPath, "git-status"], {
        repositoryMode,
        branch: null,
        snapshot: "b".repeat(64),
      });
      mocks.pushProjectCommits.mockClear();
      mocks.pushProjectCommits.mockResolvedValue({ remoteState: { remote: null, remotes: [] } });
      const screen = await render(
        <QueryClientProvider client={cache}>
          <DropdownMenu open>
            <DropdownItems
              apps={[]}
              isPending={false}
              onSelect={vi.fn()}
              onReference={vi.fn()}
              remote={target}
              target={{
                absolutePath: "/plain",
                path: "/plain",
                relativePath: ".",
                type: "directory",
              }}
            />
          </DropdownMenu>
        </QueryClientProvider>,
      );
      const item = page.getByRole("menuitem", { name: /打开远程仓库|Open remote repository/u });
      await (repositoryMode === "root" ? assertNoRemote : assertNoRepository)(item);
      expect(mocks.getProjectGitStatus).not.toHaveBeenCalled();
      await screen.unmount();
      cache.clear();
    },
  );
});
