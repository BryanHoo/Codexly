import { describe, expect, it } from "vitest";

import type { Project } from "@code-agent/protocol";

import { mapCodexServerRequest } from "./codex-protocol-mapping.js";

const project: Project = {
  createdAt: "2026-08-18T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  roots: [{ id: "root-code-agent", path: "/workspace/CodeAgent" }],
};

describe("Codex permission server request mapping", () => {
  it("normalizes additional permissions on command approvals", () => {
    const entry = mapCodexServerRequest(
      {
        id: "command-1",
        method: "item/commandExecution/requestApproval",
        params: {
          additionalPermissions: {
            fileSystem: {
              entries: [
                {
                  access: "write",
                  path: { path: "/workspace/CodeAgent/.cache", type: "path" },
                },
              ],
              read: null,
              write: ["/workspace/CodeAgent/.cache"],
            },
            network: { enabled: true },
          },
          availableDecisions: ["accept", "acceptForSession", "decline"],
          command: "pnpm install",
          cwd: "/workspace/CodeAgent",
          environmentId: null,
          itemId: "command-item-1",
          reason: "需要安装依赖",
          startedAtMs: 1_776_643_200_000,
          threadId: "task-1",
          turnId: "turn-1",
        },
      },
      project,
    );

    expect(entry).toMatchObject({
      request: {
        additionalPermissions: {
          fileSystem: {
            entries: [
              {
                access: "write",
                path: { type: "path", value: "/workspace/CodeAgent/.cache" },
              },
            ],
            read: null,
            write: ["/workspace/CodeAgent/.cache"],
          },
          network: { enabled: true },
        },
        type: "command_approval",
      },
    });
  });

  it("keeps existing user input requests mapped", () => {
    expect(
      mapCodexServerRequest(
        {
          id: "input-1",
          method: "item/tool/requestUserInput",
          params: {
            autoResolutionMs: 1_000,
            isBlocking: false,
            itemId: "input-item-1",
            questions: [
              {
                header: "确认",
                id: "confirm",
                isOther: false,
                isSecret: false,
                options: [
                  { description: "继续", label: "Yes" },
                  { description: "停止", label: "No" },
                ],
                question: "继续执行吗？",
              },
            ],
            threadId: "task-1",
            turnId: "turn-1",
          },
        },
        project,
      ),
    ).toMatchObject({ request: { requestId: "string:input-1", type: "user_input" } });
  });

  it("normalizes network and filesystem permissions without leaking native fields", () => {
    const entry = mapCodexServerRequest(
      {
        id: "permissions-1",
        method: "item/permissions/requestApproval",
        params: {
          cwd: "/workspace/CodeAgent",
          environmentId: "local",
          itemId: "permission-item-1",
          permissions: {
            fileSystem: {
              entries: [
                { access: "read", path: { path: "/workspace/CodeAgent/src", type: "path" } },
                {
                  access: "write",
                  path: { pattern: "/workspace/CodeAgent/*.log", type: "glob_pattern" },
                },
                { access: "deny", path: { type: "special", value: { kind: "tmpdir" } } },
              ],
              globScanMaxDepth: 4,
              read: ["/workspace/CodeAgent/README.md"],
              write: ["/workspace/CodeAgent/.cache"],
            },
            network: { enabled: true },
          },
          reason: "需要安装依赖并写入缓存",
          startedAtMs: 1_776_643_200_000,
          threadId: "task-1",
          turnId: "turn-1",
        },
      },
      project,
    );

    expect(entry).toMatchObject({
      nativePermissionProfile: {
        fileSystem: {
          entries: [
            { access: "read", path: { path: "/workspace/CodeAgent/src", type: "path" } },
            {
              access: "write",
              path: { pattern: "/workspace/CodeAgent/*.log", type: "glob_pattern" },
            },
            { access: "deny", path: { type: "special", value: { kind: "tmpdir" } } },
          ],
          globScanMaxDepth: 4,
          read: ["/workspace/CodeAgent/README.md"],
          write: ["/workspace/CodeAgent/.cache"],
        },
        network: { enabled: true },
      },
      request: {
        cwd: "/workspace/CodeAgent",
        environmentId: "local",
        permissions: {
          fileSystem: {
            entries: [
              { access: "read", path: { type: "path", value: "/workspace/CodeAgent/src" } },
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
            read: ["/workspace/CodeAgent/README.md"],
            write: ["/workspace/CodeAgent/.cache"],
          },
          network: { enabled: true },
        },
        reason: "需要安装依赖并写入缓存",
        type: "permissions_approval",
      },
    });
  });

  it("rejects malformed filesystem access modes", () => {
    expect(() =>
      mapCodexServerRequest(
        {
          id: "permissions-invalid",
          method: "item/permissions/requestApproval",
          params: {
            cwd: "/workspace/CodeAgent",
            environmentId: null,
            itemId: "permission-item-invalid",
            permissions: {
              fileSystem: {
                entries: [{ access: "execute", path: { path: "/workspace/tool", type: "path" } }],
                read: null,
                write: null,
              },
              network: null,
            },
            reason: null,
            startedAtMs: 1_776_643_200_000,
            threadId: "task-1",
            turnId: "turn-1",
          },
        },
        project,
      ),
    ).toThrow(/access/u);
  });
});
