import { describe, expect, it } from "vitest";

import {
  WorkbenchInspector,
  gitStatus,
  nestedGitStatus,
  readInspectorTabLabels,
  renderInspectorMarkup,
} from "./workbench-inspector.test-support.js";

describe("WorkbenchInspector Git tabs", () => {
  it("hides changes for a clean worktree and returns to the first tab", () => {
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

    expect(readInspectorTabLabels(cleanMarkup)).toEqual(["项目", "上下文", "历史"]);
    expect(cleanMarkup).toMatch(/aria-selected="true"[^>]*>.*?<span[^>]*>项目<\/span>/su);
    expect(readInspectorTabLabels(nonGitMarkup)).toEqual(["项目", "上下文"]);
  });

  it("shows the commit entry for immediate child Git repositories", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={{ ...gitStatus, repositoryMode: "children" }}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="project"
        taskId="task-1"
      />,
    );
    const commitButton = /<button[^>]*id="workbench-commit-changes"[^>]*>/u.exec(markup)?.[0];

    expect(commitButton).toBeDefined();
    expect(commitButton).not.toContain(' disabled=""');
  });

  it("shows only aggregate Git change stats in project", () => {
    const renderInspector = (expandedFileTreePaths: Set<string>) =>
      renderInspectorMarkup(
        <WorkbenchInspector
          expandedFileTreePaths={expandedFileTreePaths}
          gitStatus={nestedGitStatus}
          projectName="Codexly"
          projectPath="/workspace/Codexly"
          tab="project"
          taskId="task-1"
        />,
      );

    const fileVisibleMarkup = renderInspector(new Set(["src", "src/components"]));

    expect(fileVisibleMarkup).toMatch(
      /data-git-change-count="">1 个文件<\/span>.*data-git-change-stats="">.*\+2.*-1/su,
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
