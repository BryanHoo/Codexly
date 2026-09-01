import type { AgentMcpServer } from "@codexly/protocol";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WorkbenchInspector,
  renderInspectorMarkup,
  gitStatus,
  readyMcpServer,
} from "./workbench-inspector.test-support.js";

describe("WorkbenchInspector sources", () => {
  it("shows a non-blocking retry status and offers a manual refresh after Git detection fails", () => {
    const projectMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={gitStatus}
        gitStatusError={new Error("not a git repository")}
        onOpenProjectFile={() => undefined}
        onRefreshGitStatus={() => undefined}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
      />,
    );
    const contextMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={gitStatus}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="context"
        taskId="task-1"
      />,
    );

    expect(projectMarkup).toContain("Git 变更刷新失败，正在自动重试");
    expect(contextMarkup).toContain("2 个变更");
    expect(projectMarkup).toContain("手动刷新");
    expect(projectMarkup).toContain('aria-label="手动刷新 Git 变更"');
  });

  it("renders the project file tree root loading state", () => {
    const loadingMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        onOpenProjectFile={() => undefined}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
      />,
    );
    expect(loadingMarkup).toContain('aria-label="正在读取项目文件..."');
    expect(loadingMarkup).toContain("Codexly");
    expect(loadingMarkup).toContain("animate-spin");
  });

  it("lists every subagent in context and exposes output dialog triggers", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        onOpenSubagent={() => undefined}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        subagents={[
          {
            model: "gpt-5.6-sol",
            nickname: "前端分析",
            reasoningEffort: "high",
            status: "running",
            taskId: "child-frontend",
          },
          {
            nickname: "协议检查",
            status: "completed",
            taskId: "child-protocol",
          },
        ]}
        tab="context"
        taskId="task-1"
      />,
    );

    expect(markup).toContain('aria-label="子代理"');
    expect(markup).toContain("2 个子代理");
    expect(markup).toContain("前端分析");
    expect(markup).toContain("协议检查");
    expect(markup).not.toContain(">child-frontend<");
    expect(markup).not.toContain(">child-protocol<");
    expect(markup).not.toContain("检查前端实现");
    expect(markup).toContain("GPT-5.6-Sol · high");
    expect(markup).toContain('data-status="in_progress"');
    expect(markup).toContain('data-status="completed"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-label="查看子代理 前端分析 的输出"');
  });

  it("renders enabled MCP servers without the removed environment module", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        backgroundTerminals={[
          {
            command: "pnpm check",
            cwd: "/workspace/Codexly",
            id: "terminal-1",
            itemId: "command-1",
          },
        ]}
        gitStatus={gitStatus}
        mcpServers={[
          readyMcpServer,
          { ...readyMcpServer, displayName: "Chrome DevTools", name: "chrome-devtools" },
          { ...readyMcpServer, displayName: "Remote Context", name: "remote-context" },
        ]}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        skills={[
          {
            description: "Review security-sensitive changes",
            displayName: "安全审查",
            id: "skill-security",
            name: "review-security",
            scope: "repo",
          },
        ]}
        task={{
          turns: [
            {
              completedAt: "2026-07-30T10:01:00.000Z",
              error: null,
              id: "turn-1",
              items: [
                {
                  attachments: [
                    {
                      id: "attachment-1",
                      kind: "image",
                      mediaType: "image/png",
                      name: "layout.png",
                      size: 1024,
                    },
                  ],
                  id: "message-1",
                  role: "user",
                  skills: [{ name: "review-security" }, { name: "review-security" }],
                  text: "检查布局",
                  type: "message",
                },
              ],
              startedAt: "2026-07-30T10:00:00.000Z",
              status: "completed",
            },
          ],
        }}
        tab="context"
        taskId="task-1"
      />,
    );

    expect(markup).toContain('aria-label="MCP"');
    expect(markup).toContain("Fast Context");
    expect(markup).toContain("Chrome DevTools");
    expect(markup).toContain("Remote Context");
    expect(markup).toContain("已连接");
    expect(markup).toContain("2 个工具");
    expect(markup).not.toContain("OAuth");
    expect(markup).not.toContain("认证状态未知");
    expect(markup).not.toContain("版本 1.2.0");
    expect(markup).toContain('aria-label="重新加载 MCP"');
    expect(markup).not.toContain("gpt-5.6-sol");
    expect(markup).not.toContain("自动审批");
    expect(markup).not.toContain("工作区可写");
    expect(markup).not.toContain("思考量");
    expect(markup).not.toContain("沙盒");
    expect(markup).not.toContain("分支");
    expect(markup).not.toContain("项目目录");
    expect(markup).toContain("安全审查");
    expect(markup).toContain('aria-description="Review security-sensitive changes"');
    expect(markup).toMatch(/data-inspector-source-row=""><div class="[^"]*transition-colors/u);
    expect(markup).toMatch(/data-inspector-source-row=""><div class="[^"]*hover:bg-control-hover/u);
    expect(markup.match(/lucide-sparkles/gu)).toHaveLength(1);
    expect(markup).toContain("layout.png");
    expect(markup).not.toContain("This Mac");
    expect(markup).not.toContain("项目 Agent 组件");
    expect(markup).not.toContain("Web Design");
    expect(markup).not.toContain("添加来源");
  });

  it("limits context sources to five rows and hides an empty source module", () => {
    const skills = Array.from({ length: 6 }, (_, index) => ({
      description: `Skill description ${String(index + 1)}`,
      displayName: `Skill ${String(index + 1)}`,
      id: `skill-${String(index + 1)}`,
      name: `skill-${String(index + 1)}`,
      scope: "repo" as const,
    }));
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        skills={skills}
        tab="context"
        task={{
          turns: [
            {
              completedAt: "2026-08-26T10:01:00.000Z",
              error: null,
              id: "turn-sources",
              items: [
                {
                  id: "message-sources",
                  role: "user",
                  skills: skills.map((skill) => ({ name: skill.name })),
                  text: "使用多个 Skill",
                  type: "message",
                },
              ],
              startedAt: "2026-08-26T10:00:00.000Z",
              status: "completed",
            },
          ],
        }}
        taskId="task-1"
      />,
    );
    const emptyMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="context"
        task={{ turns: [] }}
        taskId="task-1"
      />,
    );

    expect(markup.match(/data-inspector-source-row=/gu)).toHaveLength(5);
    expect(markup).toContain("Skill 5");
    expect(markup).not.toContain("Skill 6");
    expect(markup).toContain(">显示更多</button>");
    expect(emptyMarkup).not.toContain('aria-label="来源"');
  });

  it("limits MCP servers to five compact summary rows", () => {
    const servers = Array.from({ length: 6 }, (_, index) => ({
      ...readyMcpServer,
      name: `mcp-tool-${String(index + 1)}`,
      displayName: `MCP Tool ${String(index + 1)}`,
    }));
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        mcpServers={servers}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="context"
        taskId="task-1"
      />,
    );

    expect(markup.match(/data-mcp-server-row=/gu)).toHaveLength(5);
    expect(markup).toContain('aria-label="mcp-tool-1"');
    expect(markup).not.toContain("search_code");
    expect(markup).not.toContain("read_file");
    expect(markup).toContain("transition-colors");
    expect(markup).toContain("hover:bg-control-hover");
    expect(markup).not.toContain('aria-label="mcp-tool-6"');
    expect(markup).toContain(">显示更多</button>");
  });

  it("positions source tooltips above their rows", () => {
    const sourceModule = readFileSync(
      new URL("./workbench-inspector-sources.tsx", import.meta.url),
      "utf8",
    );
    expect(sourceModule).toContain('<TooltipContent side="top">{source.tooltip}</TooltipContent>');
  });

  it("reuses timeline image preview and file download actions for attachment sources", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        projectId="project one"
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="context"
        task={{
          turns: [
            {
              completedAt: "2026-08-11T10:01:00.000Z",
              error: null,
              id: "turn-1",
              items: [
                {
                  attachments: [
                    {
                      id: "image/1",
                      kind: "image",
                      mediaType: "image/png",
                      name: "layout.png",
                      size: 1024,
                    },
                    {
                      id: "text/1",
                      kind: "text",
                      mediaType: "text/plain",
                      name: "notes.txt",
                      size: 128,
                    },
                    {
                      id: "file/1",
                      kind: "file",
                      mediaType: "application/pdf",
                      name: "report.pdf",
                      size: 2048,
                    },
                  ],
                  id: "message-1",
                  role: "user",
                  text: "检查附件",
                  type: "message",
                },
              ],
              startedAt: "2026-08-11T10:00:00.000Z",
              status: "completed",
            },
          ],
        }}
        taskId="task/1"
      />,
    );

    expect(markup).toContain('aria-label="查看图片 layout.png"');
    expect(markup).toContain('data-message-attachment="image"');
    expect(markup).toContain('aria-label="打开附件 notes.txt"');
    expect(markup).toContain('data-attachment-open="source"');
    expect(markup).toContain('aria-label="打开附件 report.pdf"');
    expect(markup).toContain('data-attachment-open="system"');
    expect(markup).not.toContain(" download=");
    expect(markup).not.toContain('aria-label="下载附件');
  });

  it("hides the whole MCP module when no server data is available", () => {
    const renderState = (mcpServers: readonly AgentMcpServer[]) =>
      renderInspectorMarkup(
        <WorkbenchInspector
          backgroundTerminals={[
            {
              command: "pnpm check",
              cwd: "/workspace/Codexly",
              id: "terminal-1",
              itemId: "command-1",
            },
          ]}
          projectName="Codexly"
          projectPath="/workspace/Codexly"
          tab="context"
          taskId="task-1"
          mcpServers={mcpServers}
        />,
      );

    const failedMarkup = renderState([
      { displayName: "Docs", name: "docs", status: "failed", toolCount: 0 },
    ]);
    expect(failedMarkup).toContain("启动失败");
    expect(failedMarkup).toContain("0 个工具");
    expect(failedMarkup).not.toContain("查看错误日志");
    expect(renderState([])).not.toContain('aria-label="MCP"');
  });

  it("renders every Codex 0.151 MCP connection status", () => {
    const statuses = [
      ["notStarted", "未启动"],
      ["starting", "正在启动"],
      ["connected", "已连接"],
      ["authenticationRequired", "需要认证"],
      ["failed", "启动失败"],
      ["cancelled", "已取消"],
      ["disabled", "已禁用"],
      ["unknown", "状态未知"],
    ] as const;

    for (const [status, label] of statuses) {
      const markup = renderInspectorMarkup(
        <WorkbenchInspector
          mcpServers={[{ displayName: status, name: status, status, toolCount: 0 }]}
          projectName="Codexly"
          projectPath="/workspace/Codexly"
          tab="context"
          taskId="task-1"
        />,
      );
      expect(markup).toContain(`data-mcp-status="${status}"`);
      expect(markup).toContain(label);
    }
  });
});
