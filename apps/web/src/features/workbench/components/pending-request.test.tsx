import type { PendingRequest } from "@code-agent/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PendingRequestCard, resolvePendingRequestAttempt } from "./pending-request.js";
import { createPermissionApprovalResolution } from "./permission-approval-request.js";

const identity = {
  createdAt: "2026-07-23T00:00:00.000Z",
  expiresAt: null,
  itemId: "item-1",
  projectId: "code-agent",
  requestId: "number:7",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
} as const;

describe("PendingRequestCard", () => {
  it("renders granular permissions and builds a selected session grant", () => {
    const request: Extract<PendingRequest, { type: "permissions_approval" }> = {
      ...identity,
      cwd: "/workspace/CodeAgent",
      environmentId: "local",
      permissions: {
        fileSystem: {
          entries: [
            {
              access: "write",
              path: { type: "glob", value: "/workspace/CodeAgent/*.log" },
            },
            {
              access: "deny",
              path: { kind: "tmpdir", path: null, subpath: null, type: "special" },
            },
          ],
          globScanMaxDepth: 4,
          read: ["/workspace/CodeAgent/src"],
          write: null,
        },
        network: { enabled: true },
      },
      reason: "需要安装依赖并写入日志",
      type: "permissions_approval",
    };

    expect(createPermissionApprovalResolution(["network"], "session")).toEqual({
      grantedPermissions: ["network"],
      scope: "session",
    });
    expect(createPermissionApprovalResolution([], "turn")).toEqual({
      grantedPermissions: [],
      scope: "turn",
    });

    const markup = renderToStaticMarkup(
      <PendingRequestCard interactive onResolve={vi.fn()} request={request} />,
    );
    expect(markup).toContain("权限审批");
    expect(markup).toContain("网络访问");
    expect(markup).toContain("文件系统");
    expect(markup).toContain("/workspace/CodeAgent/src");
    expect(markup).toContain("/workspace/CodeAgent/*.log");
    expect(markup).toContain("系统临时目录");
    expect(markup).toContain("本轮允许");
    expect(markup).toContain("本次会话允许");
    expect(markup.match(/data-slot="checkbox"/gu)?.length).toBe(2);
    expect(markup.match(/data-state="checked"/gu)?.length).toBe(4);
  });

  it("reuses the idempotency key while retrying the same resolution", () => {
    const createKey = vi
      .fn()
      .mockReturnValueOnce("resolve-key-1")
      .mockReturnValueOnce("resolve-key-2");
    const first = resolvePendingRequestAttempt(undefined, { decision: "allow" }, createKey);
    const retried = resolvePendingRequestAttempt(first, { decision: "allow" }, createKey);
    const changed = resolvePendingRequestAttempt(retried, { decision: "deny" }, createKey);

    expect(retried).toBe(first);
    expect(changed).toEqual({ fingerprint: '{"decision":"deny"}', key: "resolve-key-2" });
    expect(createKey).toHaveBeenCalledTimes(2);
  });

  it("renders approval actions and disables queued requests", () => {
    const request: PendingRequest = {
      ...identity,
      additionalPermissions: {
        fileSystem: {
          entries: [
            {
              access: "write",
              path: { type: "path", value: "/workspace/CodeAgent/.cache" },
            },
          ],
          globScanMaxDepth: null,
          read: null,
          write: ["/workspace/CodeAgent/.cache"],
        },
        network: { enabled: true },
      },
      availableDecisions: ["allow", "allow_for_session", "deny"],
      command: "pnpm check",
      cwd: "/workspace/CodeAgent",
      networkAccess: null,
      reason: "需要执行检查",
      type: "command_approval",
    };
    const active = renderToStaticMarkup(
      <PendingRequestCard interactive onResolve={vi.fn()} request={request} />,
    );
    const queued = renderToStaticMarkup(
      <PendingRequestCard interactive={false} onResolve={vi.fn()} request={request} />,
    );

    expect(active).toContain("命令审批");
    expect(active).toContain("额外权限");
    expect(active).toContain("网络访问");
    expect(active).toContain("/workspace/CodeAgent/.cache");
    expect(active).toContain("本次会话允许");
    expect(active).toContain("允许");
    expect(active).toContain("拒绝");
    expect(active).toMatch(/class="[^"]*bg-danger[^"]*"[^>]*>拒绝<\/button>/);
    expect(active).toMatch(/class="[^"]*bg-brand[^"]*"[^>]*>允许<\/button>/);
    expect(queued).toContain("等待处理前一项");
    expect(queued.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("renders managed network approvals with their target", () => {
    const request: PendingRequest = {
      ...identity,
      availableDecisions: ["allow", "deny"],
      command: null,
      cwd: null,
      networkAccess: { host: "api.example.com", protocol: "https" },
      reason: "需要访问外部 API",
      type: "command_approval",
    };
    const markup = renderToStaticMarkup(
      <PendingRequestCard interactive onResolve={vi.fn()} request={request} />,
    );

    expect(markup).toContain("网络访问审批");
    expect(markup).toContain("api.example.com");
    expect(markup).toContain("HTTPS");
  });

  it("renders choice, confirmation, and short text with semantic controls", () => {
    const request: PendingRequest = {
      ...identity,
      questions: [
        {
          header: "模式",
          id: "mode",
          isOther: true,
          isSecret: false,
          options: [
            { description: "继续实现", label: "继续" },
            { description: "停止工作", label: "停止" },
            { description: "重新规划", label: "调整" },
          ],
          prompt: "下一步怎么处理？",
          type: "choice",
        },
        {
          header: "确认",
          id: "confirm",
          isOther: false,
          isSecret: false,
          options: [
            { description: "确认继续", label: "Yes" },
            { description: "取消操作", label: "No" },
          ],
          prompt: "继续执行吗？",
          type: "confirmation",
        },
        {
          header: "备注",
          id: "note",
          isOther: false,
          isSecret: false,
          options: [],
          prompt: "补充说明",
          type: "short_text",
        },
      ],
      requestId: "string:input-1",
      type: "user_input",
    };
    const markup = renderToStaticMarkup(
      <PendingRequestCard interactive onResolve={vi.fn()} request={request} />,
    );

    expect(markup).toContain('type="radio"');
    expect(markup).not.toMatch(/data-slot="input"[^>]*type="radio"/u);
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('type="text"');
    expect(markup).toContain('data-variant="compact"');
    expect(markup).toContain("提交回答");
    expect(markup).toMatch(/class="[^"]*bg-brand[^"]*"[^>]*>提交回答<\/button>/);
  });

  it("renders MCP form fields and URL confirmation with accessible controls", () => {
    const form = {
      ...identity,
      fields: [
        {
          defaultValue: true,
          description: "允许工具继续执行",
          id: "confirmed",
          required: true,
          title: "确认",
          type: "boolean",
        },
        {
          defaultValue: "staging",
          description: null,
          id: "environment",
          options: [
            { label: "Staging", value: "staging" },
            { label: "Production", value: "production" },
          ],
          required: true,
          title: "环境",
          type: "select",
        },
        {
          defaultValue: null,
          description: null,
          id: "replicas",
          maximum: 10,
          minimum: 1,
          required: false,
          title: "副本数",
          type: "integer",
        },
      ],
      message: "配置部署",
      mode: "form",
      serverName: "deploy",
      type: "mcp_elicitation",
    } as unknown as PendingRequest;
    const formMarkup = renderToStaticMarkup(
      <PendingRequestCard interactive onResolve={vi.fn()} request={form} />,
    );
    expect(formMarkup).toContain("配置部署");
    expect(formMarkup).toContain('type="checkbox"');
    expect(formMarkup).toContain("Staging");
    expect(formMarkup).toContain('type="number"');

    const url = {
      ...identity,
      message: "连接 GitHub 账号",
      mode: "url",
      serverName: "github",
      type: "mcp_elicitation",
      url: "https://github.com/login/oauth/authorize",
    } as unknown as PendingRequest;
    const urlMarkup = renderToStaticMarkup(
      <PendingRequestCard interactive onResolve={vi.fn()} request={url} />,
    );
    expect(urlMarkup).toContain('target="_blank"');
    expect(urlMarkup).toContain('rel="noreferrer noopener"');
    expect(urlMarkup).toContain("连接 GitHub 账号");
  });

  it("keeps expired requests visible without interactive controls", () => {
    const request: PendingRequest = {
      ...identity,
      availableDecisions: ["allow", "deny"],
      grantRoot: "/workspace/CodeAgent",
      reason: null,
      status: "expired",
      type: "file_change_approval",
    };
    const markup = renderToStaticMarkup(
      <PendingRequestCard interactive onResolve={vi.fn()} request={request} />,
    );

    expect(markup).toContain("请求已过期");
    expect(markup).not.toContain(">允许<");
    expect(markup).not.toContain(">拒绝<");
  });
});
