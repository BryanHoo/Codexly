import type { AgentMcpServer } from "@codexly/protocol";
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
          { ...readyMcpServer, authStatus: "unsupported", name: "chrome-devtools" },
          { ...readyMcpServer, authStatus: "unknown", name: "remote-context" },
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
    expect(markup).toContain("fast-context");
    expect(markup).toContain("chrome-devtools");
    expect(markup).toContain("remote-context");
    expect(markup).toContain("已就绪");
    expect(markup).toContain("2 个工具");
    expect(markup).toContain("OAuth");
    expect(markup).toContain("认证状态未知");
    expect(markup).toContain("版本 1.2.0");
    expect(markup).toContain('aria-label="重新加载 MCP"');
    expect(markup).not.toContain("gpt-5.6-sol");
    expect(markup).not.toContain("自动审批");
    expect(markup).not.toContain("工作区可写");
    expect(markup).not.toContain("思考量");
    expect(markup).not.toContain("沙盒");
    expect(markup).not.toContain("分支");
    expect(markup).toContain("/workspace/Codexly");
    expect(markup).toContain("项目目录");
    expect(markup).toContain("安全审查");
    expect(markup.match(/lucide-sparkles/gu)).toHaveLength(1);
    expect(markup).toContain("layout.png");
    expect(markup).not.toContain("This Mac");
    expect(markup).not.toContain("项目 Agent 组件");
    expect(markup).not.toContain("Web Design");
    expect(markup).not.toContain("添加来源");
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

  it("renders MCP loading, error, and empty states inside the context tab", () => {
    const renderState = (
      props: Readonly<{
        mcpServers?: readonly AgentMcpServer[];
        mcpServersError?: Error;
        mcpServersPending?: boolean;
      }>,
    ) =>
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
          {...props}
        />,
      );

    expect(renderState({ mcpServersPending: true })).toContain("正在读取 MCP...");
    const errorMarkup = renderState({ mcpServersError: new Error("MCP unavailable") });
    expect(errorMarkup).toContain("无法读取 MCP");
    expect(errorMarkup).toContain("MCP unavailable");
    expect(errorMarkup).not.toContain("查看错误日志");
    const retryErrorMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        mcpServersError={new Error("mcpServerStatus/list failed")}
        projectName="Codexly"
        projectPath="/workspace/Codexly"
        tab="context"
        taskId="task-1"
      />,
    );
    expect(retryErrorMarkup).toContain("无法读取 MCP");
    expect(retryErrorMarkup).toContain("mcpServerStatus/list failed");
    expect(retryErrorMarkup).not.toContain("重新加载 MCP 失败");
    const failedMarkup = renderState({
      mcpServers: [
        {
          authStatus: null,
          description: null,
          error: "MCP startup timed out after 10s\nProcess exited with code 1",
          failureReason: "reauthenticationRequired",
          name: "docs",
          status: "failed",
          title: null,
          toolCount: 0,
          version: null,
        },
      ],
    });
    expect(failedMarkup).toContain("启动失败");
    expect(failedMarkup).toContain("需要重新认证");
    expect(failedMarkup).toContain("查看错误日志");
    expect(failedMarkup).toContain("MCP startup timed out after 10s");
    expect(renderState({ mcpServers: [] })).toContain("当前任务没有可读取的 MCP");
  });
});
