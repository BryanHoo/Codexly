import { describe, expect, it } from "vitest";
import {
  WorkbenchInspector,
  renderInspectorMarkup,
  gitStatus,
  lightweightGitStatus,
  nestedGitStatus,
  readyMcpServer,
  readInspectorTabLabels,
} from "./workbench-inspector.test-support.js";
import { WorkbenchInspectorTabs } from "./workbench-inspector-tabs.js";

describe("WorkbenchInspector tabs", () => {
  it("renders the close action inside the active file tab surface", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspectorTabs
        activeTab="file"
        availableTabs={["context", "file"]}
        onCloseFile={() => undefined}
        onTabChange={() => undefined}
      />,
    );

    expect(readInspectorTabLabels(markup)).toEqual(["上下文", "文件"]);
    expect(markup).toMatch(
      /<div[^>]*role="group"[^>]*>.*?<button[^>]*role="tab"[^>]*>.*?文件<\/span><\/button>.*?aria-label="关闭文件".*?<\/div>/su,
    );
    const closeButton = /<button[^>]*aria-label="关闭文件"[^>]*>/u.exec(markup)?.[0];
    expect(closeButton).toContain('data-size="embedded"');
    expect(closeButton).toMatch(/\bsize-4\b/u);
    expect(markup).toContain("lucide-x");
  });

  it("mounts the selected source inside the file tab instead of a dialog", () => {
    const sourcePath =
      "src/features/workbench/components/nested/very-long-directory/very-long-source-file-name.tsx";
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        fileSelection={{
          kind: "source",
          reference: { lineNumber: 12, path: sourcePath },
        }}
        onCloseFile={() => undefined}
        projectId="project-1"
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="file"
        taskId="task-1"
      />,
    );

    expect(readInspectorTabLabels(markup)).toEqual(["上下文", "项目", "文件"]);
    expect(markup).toContain('aria-selected="true"');
    const pathTrigger =
      /<div(?=[^>]*data-slot="tooltip-trigger")(?=[^>]*class="([^"]*)")[^>]*>/u.exec(markup);
    expect(pathTrigger?.[1]?.split(" ")).toEqual(
      expect.arrayContaining(["w-0", "overflow-hidden"]),
    );
    expect(markup).toContain(sourcePath);
    expect(markup).not.toContain(`title="${sourcePath}"`);
    expect(markup).toContain("正在加载源文件");
    expect(markup).not.toContain('role="dialog"');
  });

  it("mounts the selected Diff inside the file tab instead of a dialog", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        fileSelection={{
          change: {
            diff: "@@ -1 +1 @@\n-export const live = false;\n+export const live = true;",
            kind: "update",
            path: "src/live.ts",
          },
          kind: "diff",
        }}
        onCloseFile={() => undefined}
        projectId="project-1"
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="file"
        taskId="task-1"
      />,
    );

    expect(readInspectorTabLabels(markup)).toEqual(["上下文", "项目", "文件"]);
    expect(markup).toContain('aria-label="src/live.ts"');
    expect(markup).toContain("live.ts");
    expect(markup).toContain("+1");
    expect(markup).toContain("-1");
    expect(markup).toContain("正在加载 Diff");
    expect(markup).not.toContain('role="dialog"');
  });

  it("mounts the headless project file tree in the project tab", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        projectId="project-1"
        projectName="Codexly"
        projectPath="/workspace/Codexly"
      />,
    );

    expect(markup).toContain('data-project-file-tree=""');
  });

  it("renders the latest task plan as a plain status-aware queue at the bottom of context", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="context"
        taskId="task-1"
        task={{
          plan: {
            explanation: "先打通数据链路，再完成界面验证。",
            steps: [
              { status: "completed", text: "定义计划协议" },
              { status: "in_progress", text: "接入右栏上下文" },
              { status: "pending", text: "执行完整验证" },
            ],
          },
          turns: [],
        }}
      />,
    );

    expect(markup).toContain('aria-label="计划"');
    expect(markup).toContain('data-ai-queue=""');
    expect(markup).toContain("先打通数据链路，再完成界面验证。");
    expect(markup).toMatch(/data-status="completed"[^>]*>.*定义计划协议/su);
    expect(markup).toMatch(/data-status="in_progress"[^>]*>.*接入右栏上下文/su);
    expect(markup).toMatch(/data-status="pending"[^>]*>.*执行完整验证/su);
    expect(markup).toContain('aria-label="已完成"');
    const queueClassName = /class="([^"]*)" data-ai-queue=""/u.exec(markup)?.[1];
    expect(queueClassName).toBeDefined();
    expect(queueClassName).not.toMatch(/\b(?:rounded-surface|border|bg-panel|shadow-sm)\b/u);
    expect(markup.indexOf('aria-label="计划"')).toBeGreaterThan(
      markup.indexOf('aria-label="上下文来源"'),
    );
  });

  it("renders persisted Goal details and lifecycle controls at the top of context", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        onClearGoal={() => Promise.resolve()}
        onGoalStatusChange={() => Promise.resolve()}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="context"
        taskId="task-1"
        task={{
          goal: {
            createdAt: "2026-08-25T00:00:00.000Z",
            objective: "完成官方 Goal 生命周期对接",
            status: "active",
            timeUsedSeconds: 90,
            tokenBudget: 20_000,
            tokensUsed: 4_096,
            updatedAt: "2026-08-25T00:01:30.000Z",
          },
          turns: [],
        }}
      />,
    );

    expect(markup).toContain('aria-label="目标"');
    expect(markup).toContain("完成官方 Goal 生命周期对接");
    expect(markup).toContain("进行中");
    expect(markup).toContain("4,096 / 20,000 tokens");
    expect(markup).toContain('aria-label="暂停目标"');
    expect(markup).toContain('aria-label="清除目标"');
    expect(markup).toMatch(/role="tabpanel"[^>]*>.*aria-label="目标"/su);
  });

  it("renders temporary task context directly without tabs or Project sources", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        contextOnly
        mcpServers={[readyMcpServer]}
        projectName="临时任务"
        projectPath=""
      />,
    );

    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain('role="tab"');
    expect(markup).not.toContain("项目目录");
    expect(markup).toContain('aria-label="MCP"');
    expect(markup).toContain("fast-context");
    expect(markup).not.toContain("Semantic repository search");
    expect(markup).not.toContain('aria-label="来源"');
  });

  it("renders per-server MCP loading and ready states without provider descriptions", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        contextOnly
        mcpServers={[
          { ...readyMcpServer, name: "context7", status: "starting", toolCount: 0 },
          readyMcpServer,
        ]}
        projectName="临时任务"
        projectPath=""
      />,
    );

    expect(markup).toContain("context7");
    expect(markup).toContain("正在启动");
    expect(markup).toContain("fast-context");
    expect(markup).toContain("已就绪");
    expect(markup).not.toContain("Semantic repository search");
  });

  it("keeps the user-controlled project tab selected while terminals are running", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        backgroundTerminals={[
          {
            command: "pnpm dev",
            cwd: "/workspace/Codexly",
            id: "terminal-1",
            itemId: "command-1",
          },
        ]}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
      />,
    );

    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain(">项目</span></button>");
    expect(markup).not.toContain('aria-label="运行中的终端"');
    expect(markup).not.toContain("pnpm dev");
  });

  it("renders the uncommitted change summary in context and removes it from project", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        onOpenProjectFile={() => undefined}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        gitStatus={lightweightGitStatus}
        gitStatusDetails={gitStatus}
        tab="context"
        taskId="task-1"
      />,
    );
    const projectMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={lightweightGitStatus}
        gitStatusDetails={gitStatus}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="project"
        taskId="task-1"
      />,
    );

    expect(markup).toContain("2 个变更");
    expect(markup).toContain('aria-label="未提交变更"');
    expect(markup).toContain('aria-label="提交 2 个未提交变更"');
    expect(markup).toContain(">提交</button>");
    expect(markup).toMatch(
      /aria-label="查看 2 个未提交变更"[^>]*><span>2 个变更<\/span><span[^>]*>\+3<\/span><span[^>]*>-1<\/span>/u,
    );
    const changeSummaryButton = /<button[^>]*aria-label="查看 2 个未提交变更"[^>]*>/u.exec(
      markup,
    )?.[0];
    expect(changeSummaryButton).toBeDefined();
    expect(changeSummaryButton).toContain('data-open-inspector-changes=""');
    expect(changeSummaryButton).toContain("transition-colors");
    expect(changeSummaryButton).toContain("hover:bg-control-hover");
    expect(markup).not.toContain('aria-label="变更文件导航"');
    expect(markup).not.toContain('aria-label="package.json，新增 2 行，删除 1 行"');
    expect(markup).not.toContain('aria-label="new-file.ts，新增 1 行，删除 0 行"');
    expect(projectMarkup).not.toContain('aria-label="未提交变更"');
    expect(projectMarkup).not.toContain('data-open-inspector-changes=""');
    expect(projectMarkup).not.toContain('aria-label="提交 2 个未提交变更"');
    expect(markup).not.toContain("bg-brand");
    expect(markup).toContain('aria-label="运行环境"');
    expect(markup).not.toContain(">运行环境</h2>");
    expect(markup).not.toContain("grid-cols-2");
    const selectedTabClassName =
      /class="([^"]*)"[^>]*data-variant="ghost"[^>]*aria-selected="true"/u.exec(markup)?.[1];
    expect(selectedTabClassName).toBeDefined();
    expect(selectedTabClassName?.split(" ")).toContain("bg-control-hover");
    expect(selectedTabClassName?.split(" ")).toContain("text-foreground");
    expect(markup).not.toContain("shadow-toolbar");
    expect(markup).toContain("lucide-braces");
    expect(projectMarkup).toContain("lucide-folder-tree");
    expect(markup).toContain(">项目</span></button>");
    expect(markup).toContain(">变更</span></button>");
    expect(markup).toContain(">历史</span></button>");
    expect(markup).toContain(">上下文</span></button>");
    expect(projectMarkup).toContain('aria-label="项目文件"');
    expect(projectMarkup).toContain(">Codexly</span>");
    expect(projectMarkup).toContain('data-project-file-tree=""');
    expect(markup).not.toContain('aria-label="Git 变更文件"');
    expect(markup).not.toContain("未暂存");
    expect(markup).not.toContain("已暂存");

    expect(markup).not.toContain(">项目文件</span>");
  });

  it("orders tabs by context, project, changes and history when all are available", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={lightweightGitStatus}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        taskId="task-1"
      />,
    );

    expect(readInspectorTabLabels(markup)).toEqual(["上下文", "项目", "变更", "历史"]);
    expect(markup).toContain("lucide-braces");
    expect(markup).toContain('data-size="toolbar"');
  });

  it("shows Git tabs only for repositories and hides changes for a clean worktree", () => {
    const cleanGitStatus = { ...gitStatus, staged: [], unstaged: [] };
    const cleanMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={cleanGitStatus}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="changes"
        taskId="task-1"
      />,
    );
    const nonGitMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={{ ...cleanGitStatus, repositoryMode: "none" }}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        taskId="task-1"
      />,
    );

    expect(readInspectorTabLabels(cleanMarkup)).toEqual(["上下文", "项目", "历史"]);
    expect(cleanMarkup).toMatch(/aria-selected="true"[^>]*>.*?<span>项目<\/span>/su);
    expect(readInspectorTabLabels(nonGitMarkup)).toEqual(["上下文", "项目"]);
  });

  it("shows the commit entry for immediate child Git repositories", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={{ ...gitStatus, repositoryMode: "children" }}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="context"
        taskId="task-1"
      />,
    );
    const commitButton = /<button[^>]*id="workbench-commit-changes"[^>]*>/u.exec(markup)?.[0];

    expect(commitButton).toBeDefined();
    expect(commitButton).not.toContain(' disabled=""');
  });

  it("shows only aggregate Git change stats in context", () => {
    const renderInspector = (expandedFileTreePaths: Set<string>) =>
      renderInspectorMarkup(
        <WorkbenchInspector
          expandedFileTreePaths={expandedFileTreePaths}
          gitStatus={nestedGitStatus}
          projectName="Codexly"
          projectPath="/workspace/Codexly"
          tab="context"
          taskId="task-1"
        />,
      );

    const fileVisibleMarkup = renderInspector(new Set(["src", "src/components"]));

    expect(fileVisibleMarkup).toMatch(
      /aria-label="查看 1 个未提交变更"[^>]*><span>1 个变更<\/span><span[^>]*>\+2<\/span><span[^>]*>-1<\/span>/u,
    );
    expect(fileVisibleMarkup).not.toContain("后代新增");
    expect(fileVisibleMarkup).not.toContain('aria-label="变更文件导航"');
    expect(fileVisibleMarkup).not.toContain("src/components/app.tsx");
  });

  it("omits the uncommitted changes module when the working tree is clean", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        onOpenProjectFile={() => undefined}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="context"
        taskId="task-1"
      />,
    );
    const projectMarkup = renderInspectorMarkup(
      <WorkbenchInspector projectName="Codexly" projectPath="/workspace/Codexly" tab="project" />,
    );

    expect(markup).not.toContain('aria-label="未提交变更"');
    expect(markup).not.toContain(">审核</button>");
    expect(markup).not.toContain(">提交</button>");
    expect(markup).not.toContain(">项目文件</span>");
    expect(projectMarkup).toContain(">Codexly</span>");
    expect(markup).not.toContain("workbench-shell.tsx");
    expect(markup).not.toContain('id="workbench-git-history"');
    expect(markup).not.toContain('aria-label="查看 Git 历史"');
  });
});
