import { describe, expect, it, vi } from "vitest";
import { createCodexRuntimeProvider } from "./agent-provider.js";
import {
  FakeRpcClient,
  projectRootPath,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider model and skill catalogs", () => {
  it("lists all visible Codex models through the provider contract", async () => {
    const rpc = new FakeRpcClient([
      {
        data: [
          {
            defaultReasoningEffort: "high",
            description: "适合复杂编码任务",
            displayName: "GPT-5.6 Sol",
            hidden: false,
            isDefault: true,
            model: "gpt-5.6-sol",
            multiAgentVersion: "v2",
            supportedReasoningEfforts: [
              { description: "快速回答", reasoningEffort: "low" },
              { description: "深入分析", reasoningEffort: "high" },
            ],
          },
        ],
        nextCursor: "models-page-2",
      },
      {
        data: [
          {
            defaultReasoningEffort: "low",
            description: "隐藏模型",
            displayName: "Hidden",
            hidden: true,
            isDefault: false,
            model: "hidden-model",
            multiAgentVersion: "disabled",
            supportedReasoningEfforts: [{ description: "快速回答", reasoningEffort: "low" }],
          },
          {
            defaultReasoningEffort: "medium",
            description: "快速编码模型",
            displayName: "GPT-5.6 Terra",
            hidden: false,
            isDefault: false,
            model: "gpt-5.6-terra",
            multiAgentVersion: null,
            supportedReasoningEfforts: [
              { description: "平衡速度与深度", reasoningEffort: "medium" },
            ],
          },
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.listModels()).resolves.toEqual({
      data: [
        {
          defaultReasoningEffort: "high",
          description: "适合复杂编码任务",
          displayName: "GPT-5.6 Sol",
          id: "gpt-5.6-sol",
          isDefault: true,
          supportedReasoningEfforts: [
            { description: "快速回答", id: "low" },
            { description: "深入分析", id: "high" },
          ],
        },
        {
          defaultReasoningEffort: "medium",
          description: "快速编码模型",
          displayName: "GPT-5.6 Terra",
          id: "gpt-5.6-terra",
          isDefault: false,
          supportedReasoningEfforts: [{ description: "平衡速度与深度", id: "medium" }],
        },
      ],
      nextCursor: null,
    });
    expect(rpc.calls).toEqual([
      { method: "model/list", params: { includeHidden: false, limit: 100 } },
      {
        method: "model/list",
        params: { cursor: "models-page-2", includeHidden: false, limit: 100 },
      },
    ]);
  });

  it("rejects Codex models without the 0.153.4 multi-agent version field", async () => {
    const rpc = new FakeRpcClient([
      {
        data: [
          {
            defaultReasoningEffort: "high",
            description: "缺少新字段",
            displayName: "Incomplete",
            hidden: false,
            isDefault: true,
            model: "incomplete-model",
            supportedReasoningEfforts: [{ description: "深入分析", reasoningEffort: "high" }],
          },
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.listModels()).rejects.toThrow(
      "Codex model multi-agent version is invalid",
    );
  });

  it("lists enabled project skills and submits the native Codex skill input", async () => {
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-skill",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      {
        data: [
          {
            cwd: projectRootPath,
            errors: [],
            skills: [
              {
                description: "Security audit specialist",
                enabled: true,
                interface: {
                  displayName: "Security review",
                  shortDescription: "审查认证、授权和敏感数据边界",
                },
                name: "review-security",
                path: "/Users/test/.codex/skills/review-security/SKILL.md",
                pluginId: null,
                scope: "system",
                shortDescription: null,
              },
              {
                description: "Documentation specialist",
                enabled: true,
                interface: {
                  displayName: "Documentation writer",
                  shortDescription: "编写清晰的项目文档",
                },
                name: "documentation-writer",
                path: "/Users/test/.codex/skills/documentation-writer/SKILL.md",
                pluginId: "plugin-docs",
                scope: "user",
                shortDescription: null,
              },
              {
                description: "Disabled skill",
                enabled: false,
                interface: null,
                name: "disabled-skill",
                path: "/Users/test/.codex/skills/disabled-skill/SKILL.md",
                pluginId: null,
                scope: "user",
                shortDescription: null,
              },
            ],
          },
        ],
      },
      { thread: nativeThread() },
      { turn: runningTurn },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const skillPage = await provider.listSkills();
    const selectedSkill = skillPage.data[0];
    const secondSkill = skillPage.data[1];
    if (selectedSkill === undefined || secondSkill === undefined) {
      throw new Error("Expected two enabled Codex skills");
    }
    expect(selectedSkill.id).toMatch(/^skill_[a-f0-9]{32}$/u);
    expect(skillPage).toEqual({
      data: [
        {
          description: "审查认证、授权和敏感数据边界",
          displayName: "Security review",
          id: selectedSkill.id,
          name: "review-security",
          scope: "system",
        },
        {
          description: "编写清晰的项目文档",
          displayName: "Documentation writer",
          id: secondSkill.id,
          name: "documentation-writer",
          scope: "user",
        },
      ],
      nextCursor: null,
    });
    await provider.startTask();
    await expect(
      provider.startTurn(
        "task-1",
        {
          files: [],
          images: [],
          skills: [
            { id: selectedSkill.id, name: "review-security" },
            { id: secondSkill.id, name: "documentation-writer" },
          ],
          text: "",
          textAttachments: [],
        },
        {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          collaborationMode: "plan",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).resolves.toMatchObject({ id: "turn-skill", status: "running" });

    expect(rpc.calls).toEqual([
      {
        method: "skills/list",
        params: { cwds: [projectRootPath], forceReload: false },
      },
      {
        method: "thread/start",
        params: {
          config: { "tools.update_plan.enabled": true },
          cwd: projectRootPath,
          historyMode: "paginated",
          projectId: project.id,
          runtimeWorkspaceRoots: [projectRootPath],
        },
      },
      {
        method: "turn/start",
        params: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          collaborationMode: {
            mode: "plan",
            settings: {
              developer_instructions: null,
              model: "gpt-5.6-sol",
              reasoning_effort: "high",
            },
          },
          effort: "high",
          input: [
            {
              text: "$review-security $documentation-writer",
              text_elements: [],
              type: "text",
            },
            {
              name: "review-security",
              path: "/Users/test/.codex/skills/review-security/SKILL.md",
              type: "skill",
            },
            {
              name: "documentation-writer",
              path: "/Users/test/.codex/skills/documentation-writer/SKILL.md",
              type: "skill",
            },
          ],
          model: "gpt-5.6-sol",
          sandboxPolicy: {
            excludeSlashTmp: false,
            excludeTmpdirEnvVar: false,
            networkAccess: false,
            type: "workspaceWrite",
            writableRoots: [],
          },
          serviceTier: null,
          threadId: "task-1",
        },
      },
    ]);
  });

  it("rejects skills without the 0.153.4 plugin ownership field", async () => {
    const rpc = new FakeRpcClient([
      {
        data: [
          {
            cwd: projectRootPath,
            errors: [],
            skills: [
              {
                description: "Incomplete skill",
                enabled: true,
                interface: null,
                name: "incomplete-skill",
                path: "/Users/test/.codex/skills/incomplete-skill/SKILL.md",
                scope: "user",
                shortDescription: null,
              },
            ],
          },
        ],
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.listSkills()).rejects.toThrow("skills/list skill pluginId is invalid");
  });

  it("rejects repeated model cursors and empty local image paths", async () => {
    const cursorRpc = new FakeRpcClient([
      { data: [], nextCursor: "same-page" },
      { data: [], nextCursor: "same-page" },
    ]);
    const cursorProvider = createCodexAgentProvider({ client: cursorRpc, project });
    await expect(cursorProvider.listModels()).rejects.toThrow(
      "model/list returned a repeated cursor",
    );

    const inputRpc = new FakeRpcClient([{ thread: nativeThread() }]);
    const inputProvider = createCodexAgentProvider({ client: inputRpc, project });
    await inputProvider.startTask();
    await expect(
      inputProvider.startTurn(
        "task-1",
        {
          files: [],
          images: [
            {
              detail: "auto",
              mediaType: "image/png",
              path: "",
            },
          ],
          skills: [],
          text: "",
          textAttachments: [],
        },
        {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).rejects.toThrow("Provider image path must not be empty");
    expect(inputRpc.calls).toHaveLength(1);
  });

  it("reads the project sandbox mode from Codex config", async () => {
    const rpc = new FakeRpcClient([
      { config: { sandbox_mode: "read-only" }, layers: null, origins: {} },
      { config: { sandbox_mode: null }, layers: null, origins: {} },
      { config: { sandbox_mode: "host-write" }, layers: null, origins: {} },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readSandboxMode()).resolves.toBe("read-only");
    await expect(provider.readSandboxMode()).resolves.toBe("workspace-write");
    await expect(provider.readSandboxMode()).rejects.toThrow("config/read sandbox_mode is invalid");
    expect(rpc.calls).toEqual([
      { method: "config/read", params: { cwd: projectRootPath } },
      { method: "config/read", params: { cwd: projectRootPath } },
      { method: "config/read", params: { cwd: projectRootPath } },
    ]);
  });

  it("reads supported user defaults from Codex config without project layers", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const rpc = new FakeRpcClient([
      {
        config: {
          approval_policy: "never",
          approvals_reviewer: "user",
          model: "gpt-5.6-sol",
          model_reasoning_effort: "high",
          sandbox_mode: "read-only",
        },
        layers: null,
        origins: {},
      },
      {
        config: {
          approval_policy: {
            granular: {
              mcp_elicitations: false,
              rules: false,
              sandbox_approval: true,
            },
          },
          approvals_reviewer: "user",
          model: null,
          model_reasoning_effort: null,
          sandbox_mode: null,
        },
        layers: null,
        origins: {},
      },
      {
        config: {
          approval_policy: "never",
          approvals_reviewer: "auto_review",
        },
        layers: null,
        origins: {},
      },
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });

    await expect(runtime.readDefaultSettings()).resolves.toEqual({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "read-only",
    });
    now += 60_000;
    await expect(runtime.readDefaultSettings()).resolves.toEqual({
      approvalPolicy: {
        granular: {
          mcp_elicitations: false,
          request_permissions: false,
          rules: false,
          sandbox_approval: true,
          skill_approval: false,
        },
      },
      approvalsReviewer: "user",
    });
    now += 60_000;
    await expect(runtime.readDefaultSettings()).resolves.toEqual({
      approvalPolicy: "never",
      approvalsReviewer: "auto_review",
    });
    expect(rpc.calls).toEqual([
      { method: "config/read", params: { includeLayers: false } },
      { method: "config/read", params: { includeLayers: false } },
      { method: "config/read", params: { includeLayers: false } },
    ]);
  });
});
