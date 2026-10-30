import { useState } from "react";
import "../../../shared/styles/globals.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { WorkbenchProjectFileTree } from "./workbench-project-file-tree.js";
import type { NativeFileTreeClient } from "../../projects/project-query-contracts.js";

function TreeHarness({ client }: Readonly<{ client: NativeFileTreeClient }>) {
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set());
  return (
    <WorkbenchProjectFileTree
      client={client}
      expandedPaths={expandedPaths}
      fileChangesByPath={new Map()}
      onExpandedPathsChange={setExpandedPaths}
      onOpenProjectFile={vi.fn()}
      onOpenProjectPath={vi.fn()}
      onReferenceProjectPath={vi.fn()}
      onRefreshProject={vi.fn()}
      projectId="project-a"
      projectName="Project A"
      projectOpenApps={[]}
      projectOpenPending={false}
      projectPath="/workspace/project-a"
      projectRootId="root-a"
    />
  );
}

async function mountTree() {
  await i18n.changeLanguage("zh-CN");
  const createProjectFile = vi
    .fn()
    .mockResolvedValue({
      path: "new.txt",
      tree: { entries: [{ path: "new.txt", type: "file" }], path: null },
    });
  const client = {
    createProjectFile,
    deleteProjectFile: vi.fn(),
    renameProjectFile: vi.fn(),
    listProjectFiles: vi
      .fn()
      .mockImplementation(async (_id: string, _root: string, path: string | null) => ({
        path,
        entries: path === null ? [{ path: "docs", type: "directory" }] : [],
      })),
  } satisfies NativeFileTreeClient;
  const screen = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <div style={{ height: 400, width: 320 }}>
            <TreeHarness client={client} />
          </div>
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { screen, client, createProjectFile };
}

describe("项目树新建文件", () => {
  it("取消不写入磁盘，提交期间拒绝重复提交和关闭并恢复树焦点", async () => {
    const { screen, createProjectFile } = await mountTree();
    const root = screen.getByRole("treeitem", { name: "Project A", exact: true });
    await root.hover();
    await root.getByRole("button", { name: "/workspace/project-a 的操作" }).click();
    await screen.getByRole("menuitem", { name: "新建文件", exact: true }).click();
    await screen.getByRole("textbox", { name: "名称" }).fill("cancelled.txt");
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(createProjectFile).not.toHaveBeenCalled();
    await expect.element(root).toHaveFocus();
    await root.hover();
    await root.getByRole("button", { name: "/workspace/project-a 的操作" }).click();
    await screen.getByRole("menuitem", { name: "新建文件", exact: true }).click();
    let complete: ((value: unknown) => void) | undefined;
    createProjectFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await screen.getByRole("textbox", { name: "名称" }).fill("pending.txt");
    await userEvent.keyboard("{Enter}{Enter}");
    await expect.poll(() => createProjectFile.mock.calls.length).toBe(1);
    await expect.element(screen.getByRole("button", { name: "创建", exact: true })).toBeDisabled();
    await expect.element(screen.getByRole("button", { name: "关闭", exact: true })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    complete?.({
      path: "pending.txt",
      tree: { path: null, entries: [{ path: "pending.txt", type: "file" }] },
    });
    await expect.element(screen.getByRole("treeitem", { name: "pending.txt" })).toBeVisible();
    await expect.element(root).toHaveFocus();
  });

  it("从根目录三点菜单创建文件，校验名称并只刷新目标目录", async () => {
    const { screen, createProjectFile, client } = await mountTree();
    const root = screen.getByRole("treeitem", { name: "Project A", exact: true });
    await expect.element(root).toBeVisible();
    await root.hover();
    await root.getByRole("button", { name: "/workspace/project-a 的操作" }).click();
    await screen.getByRole("menuitem", { name: "新建文件", exact: true }).click();
    const input = screen.getByRole("textbox", { name: "名称" });
    await expect.element(input).toHaveFocus();
    const submit = screen.getByRole("button", { name: "创建", exact: true });
    await expect.element(submit).toBeDisabled();
    await input.fill("../escape");
    await expect.element(submit).toBeDisabled();
    await input.fill("new.txt");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => createProjectFile.mock.calls.length).toBe(1);
    expect(createProjectFile.mock.calls[0]).toEqual([
      "project-a",
      "/workspace/project-a",
      { parentPath: null, name: "new.txt", type: "file" },
      { idempotencyKey: expect.any(String) },
    ]);
    await expect.element(screen.getByRole("treeitem", { name: "new.txt" })).toBeVisible();
    // 原生链路返回的权威父目录快照直接写入缓存，不额外执行目录查询。
    expect(client.listProjectFiles).toHaveBeenCalledTimes(1);
  });

  it("从折叠子目录右键菜单创建文件夹，出错保留名称并允许重试", async () => {
    const { screen, createProjectFile } = await mountTree();
    createProjectFile
      .mockRejectedValueOnce(
        Object.assign(new Error("conflict"), { code: "PROJECT_FILE_CONFLICT" }),
      )
      .mockResolvedValue({
        path: "docs/new-folder",
        tree: { path: "docs", entries: [{ path: "docs/new-folder", type: "directory" }] },
      });
    await screen.getByRole("treeitem", { name: "docs", exact: true }).click({ button: "right" });
    await screen.getByRole("menuitem", { name: "新建文件夹", exact: true }).click();
    await screen.getByRole("textbox", { name: "名称" }).fill("new-folder");
    await screen.getByRole("button", { name: "创建", exact: true }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("已存在");
    await expect.element(screen.getByRole("textbox", { name: "名称" })).toHaveValue("new-folder");
    await screen.getByRole("button", { name: "创建", exact: true }).click();
    await expect
      .element(screen.getByRole("treeitem", { name: "new-folder", exact: true }))
      .toBeVisible();
    expect(createProjectFile.mock.calls[1]?.[2]).toEqual({
      parentPath: "docs",
      name: "new-folder",
      type: "directory",
    });
    expect(createProjectFile.mock.calls[0]?.[3]).not.toEqual(createProjectFile.mock.calls[1]?.[3]);
  });
});
