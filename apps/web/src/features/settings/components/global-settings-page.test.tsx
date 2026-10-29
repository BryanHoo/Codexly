import { renderToReadableStream } from "react-dom/server";
import type { AppInfoResponse, AgentModel } from "@codexly/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { GlobalSettingsPage } from "./global-settings-page.js";
import { AgentSettingsPanel } from "./agent-settings-panel.js";
import { resolveGlobalSettingsModel } from "./global-settings-model.js";
import { CodexlyClient } from "@codexly/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  applyApprovalMode,
  createFallbackSettings,
  deriveApprovalMode,
} from "./global-settings-model.js";
import { GlobalSettingsAbout } from "./global-settings-about.js";
import { AppReleaseNotesDialog } from "./app-release-notes-dialog.js";

async function renderSettingsDialog(children: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>,
  );
  await stream.allReady;
  return new Response(stream).text();
}

const models: AgentModel[] = [
  {
    defaultReasoningEffort: "high",
    description: "复杂任务",
    displayName: "GPT-5.6 Sol",
    id: "gpt-5.6-sol",
    isDefault: true,
    supportedReasoningEfforts: [
      { description: "低", id: "low" },
      { description: "高", id: "high" },
    ],
  },
  {
    defaultReasoningEffort: "medium",
    description: "日常任务",
    displayName: "GPT-5.6 Terra",
    id: "gpt-5.6-terra",
    isDefault: false,
    supportedReasoningEfforts: [{ description: "中", id: "medium" }],
  },
];

vi.mock("./global-settings-about.js", async (importOriginal) => await importOriginal());

describe("GlobalSettingsPage", () => {
  beforeEach(async () => {
    await changeAppLanguage("zh-CN");
  });

  it.each([
    ["claude-provider", "API 地址", "默认模型"],
    ["claude-agent", "模型", "全局指令"],
    ["claude-personalization", "全局指令", "API 地址"],
  ] as const)(
    "Claude 子菜单 %s 在 Codex 设置加载失败时仍可独立打开",
    async (initialSection, field, excluded) => {
      const markup = await renderSettingsDialog(
        <GlobalSettingsPage
          client={new CodexlyClient()}
          initialSection={initialSection}
          apps={[]}
          error={new Error("Codex unavailable")}
          isPending={false}
          models={models}
          onClose={vi.fn()}
          onRetry={vi.fn()}
          onSave={vi.fn()}
        />,
      );
      expect(markup).toContain(`id="settings-panel-${initialSection}"`);
      expect(markup).toContain(field);
      expect(markup).not.toContain(`aria-label="${excluded}"`);
      expect(markup).not.toContain("Codex unavailable");
    },
  );

  it("独立展示 Git 提交设置，不加载 Codex 指令和记忆", async () => {
    const client = new CodexlyClient();
    const instructions = vi.spyOn(client, "getGlobalInstructions");
    const memories = vi.spyOn(client, "getMemorySettings");
    const markup = await renderSettingsDialog(
      <GlobalSettingsPage
        client={client}
        initialSection="git"
        apps={[]}
        error={null}
        isPending={false}
        models={models}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        settings={createFallbackSettings(models)}
      />,
    );
    expect(markup).toContain('id="settings-panel-git"');
    expect(markup).toContain('aria-label="Git message 提示词"');
    expect(markup).toContain('aria-label="任务标题提示词"');
    expect(markup).toContain('aria-label="默认模型"');
    expect(markup).toContain("辅助生成");
    expect(markup).toContain("留空时使用应用内置提示词");
    expect(markup).not.toContain('id="codex-global-instructions"');
    expect(instructions).not.toHaveBeenCalled();
    expect(memories).not.toHaveBeenCalled();
  });

  it("上下文以带单位的数字框展示千 tokens，空值清楚提示自动", async () => {
    const renderAgent = (modelContextWindow: number | null) =>
      renderSettingsDialog(
        <AgentSettingsPanel
          client={new CodexlyClient()}
          settings={{ ...createFallbackSettings(models), modelContextWindow }}
          models={models}
          fastModeAvailable={false}
          onChange={vi.fn()}
        />,
      );
    const markup = await renderAgent(400_000);
    expect(markup).toContain('type="number"');
    expect(markup).toContain('min="272"');
    expect(markup).toContain('max="1000"');
    expect(markup).toContain('step="1"');
    expect(markup).toContain('value="400"');
    expect(markup).toContain("k tokens");
    expect(markup).toContain("填写 272–1000，留空自动。");
    const automatic = await renderAgent(null);
    expect(automatic).toContain('placeholder="自动"');
    expect(automatic).toContain('value=""');
  });

  it("将自动审核作为审批下拉框中的互斥选项", () => {
    const settings = { ...createFallbackSettings(models), sandboxMode: "read-only" as const };
    const automatic = applyApprovalMode(settings, "auto-review");

    expect(automatic).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandboxMode: "read-only",
    });
    expect(deriveApprovalMode(automatic)).toBe("auto-review");
    expect(applyApprovalMode(automatic, "never")).toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxMode: "read-only",
    });
  });

  it("renders all global defaults with accessible 项目 Agent 组件 selects", async () => {
    const markup = await renderSettingsDialog(
      <GlobalSettingsPage
        client={new CodexlyClient()}
        apps={[
          { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
          { id: "system-default", kind: "system-default", name: "__SYSTEM_DEFAULT__" },
          { id: "finder", kind: "file-manager", name: "Finder" },
        ]}
        error={null}
        fastModeAvailable
        isPending={false}
        models={models}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        settings={{
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          defaultAgent: "codex" as const,
          defaultModel: "gpt-5.6-terra",
          commitMessagePrompt: "突出用户可见影响。",
          modelContextWindow: null,
          defaultOpenAppId: "visual-studio-code",
          fastMode: true,
          followUpBehavior: "queue",
          model: "gpt-5.6-sol",
          pet: { enabled: false, selectedPetId: null },
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        }}
      />,
    );

    expect(markup).not.toContain('role="dialog"');
    expect(markup).toContain('aria-label="搜索设置"');
    expect(markup).toContain("常规");
    expect(markup).toContain("个性化");
    expect(markup).toContain('aria-label="默认打开方式"');
    for (const label of ["消息吸顶", "消息目录锚点"]) {
      expect(markup).toMatch(
        new RegExp(`role="switch"[^>]*aria-label="${label}"[^>]*aria-checked="false"`),
      );
    }
    expect(markup).not.toContain("__SYSTEM_DEFAULT__");
  });

  it("offers explicit logout only for LAN access", async () => {
    const markup = await renderSettingsDialog(
      <GlobalSettingsPage
        client={new CodexlyClient()}
        accessMode="lan"
        initialSection="access"
        apps={[]}
        error={null}
        isPending={false}
        models={models}
        onClose={vi.fn()}
        onLogoutAccess={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        settings={{
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          defaultAgent: "codex" as const,
          defaultModel: "gpt-5.6-sol",
          commitMessagePrompt: "",
          modelContextWindow: null,
          defaultOpenAppId: null,
          fastMode: false,
          followUpBehavior: "queue",
          model: "gpt-5.6-sol",
          pet: { enabled: false, selectedPetId: null },
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        }}
      />,
    );

    expect(markup).toContain("局域网访问");
    expect(markup).toContain("退出局域网访问");
    expect(markup).not.toContain('aria-label="快速模式"');
  });

  it("hides the default open application setting without host capabilities", async () => {
    const markup = await renderSettingsDialog(
      <GlobalSettingsPage
        client={new CodexlyClient()}
        apps={[]}
        error={null}
        isPending={false}
        models={models}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        settings={createFallbackSettings(models)}
      />,
    );

    expect(markup).not.toContain('aria-label="默认打开方式"');
  });

  it("shows Codexly, Codex, and Claude versions with an available update", async () => {
    const appInfo: AppInfoResponse = {
      appVersion: "1.3.0",
      codexVersion: "0.163.0",
      claudeVersion: "0.2.110",
      latestVersion: "1.4.0",
      releaseNotes: "### 新增\n\n- 添加在线更新。",
      status: "available" as const,
      updateAvailable: true,
    };
    const markup = await renderSettingsDialog(
      <GlobalSettingsAbout
        onExportDiagnostics={vi.fn()}
        activeSection="about"
        appInfo={appInfo}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(markup).toContain("关于");
    expect(markup).toContain("Codexly 版本");
    expect(markup).toContain("1.3.0");
    expect(markup).toContain("Codex 版本");
    expect(markup).toContain("0.163.0");
    expect(markup).toContain("Claude 版本");
    expect(markup).toContain(
      '<span class="font-mono text-body-small text-foreground">0.2.110</span>',
    );
    expect(markup.indexOf("Claude 版本")).toBeGreaterThan(markup.indexOf("Codex 版本"));
    expect(markup.indexOf("Claude 版本")).toBeLessThan(markup.indexOf("项目 GitHub"));
    expect(markup).toContain("发现新版本 1.4.0");
    expect(markup).toContain("检查更新");
    expect(markup).toContain("更新日志");
    expect(markup).toContain("更新到 1.4.0");
    // 检查入口位于动态操作之后，窄屏仅滚动动态操作；实际位置稳定性由跨浏览器用例验证。
    expect(markup.indexOf("更新到 1.4.0")).toBeLessThan(markup.indexOf("检查更新"));
    expect(markup).toContain(
      'class="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap"',
    );
    expect(markup).not.toContain('class="flex min-w-0 flex-col items-start gap-2 py-2"');
    expect(markup).toContain("https://github.com/BryanHoo/Codexly");
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain("justify-self-start");
    expect(markup).toContain('<section id="settings-panel-about">');
  });

  it.each(["zh-CN", "en"] as const)(
    "localizes the Claude version and missing/null placeholders in %s",
    async (language) => {
      await changeAppLanguage(language);
      const label = language === "en" ? "Claude version" : "Claude 版本";
      const unknown = language === "en" ? "Unknown" : "未知";
      // 分别覆盖正常版本、旧服务端省略字段和显式 null，避免两端协议升级时出现空白行。
      for (const versionFields of [{ claudeVersion: "0.2.110" }, {}, { claudeVersion: null }]) {
        const markup = await renderSettingsDialog(
          <GlobalSettingsAbout
            onExportDiagnostics={vi.fn()}
            activeSection="about"
            appInfo={{
              appVersion: "1.3.0",
              codexVersion: "0.163.0",
              latestVersion: null,
              releaseNotes: "",
              status: "current",
              updateAvailable: false,
              ...versionFields,
            }}
            error={null}
            isPending={false}
            onRetry={vi.fn()}
            onUpdate={vi.fn()}
          />,
        );
        expect(markup).toContain(label);
        expect(markup).toContain(
          `<span class="font-mono text-body-small text-foreground">${versionFields.claudeVersion ?? unknown}</span>`,
        );
      }
    },
  );

  it("keeps About available when global settings fail to load", async () => {
    const markup = await renderSettingsDialog(
      <GlobalSettingsPage
        client={new CodexlyClient()}
        appInfo={{
          appVersion: "1.3.0",
          codexVersion: "0.163.0",
          latestVersion: "1.4.0",
          releaseNotes: "### 新增\n\n- 添加在线更新。",
          status: "available",
          updateAvailable: true,
        }}
        apps={[]}
        error={new Error("settings unavailable")}
        initialSection="about"
        isPending={false}
        models={models}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(markup).toContain("Codexly 版本");
    expect(markup).toContain("Codex 版本");
    expect(markup).not.toContain("加载全局设置失败");
  });

  it("shows updating, restart, and update-check failure states", async () => {
    const available: AppInfoResponse = {
      appVersion: "1.3.0",
      codexVersion: "0.163.0",
      latestVersion: "1.4.0",
      releaseNotes: "### 新增\n\n- 添加在线更新。",
      status: "available",
      updateAvailable: true,
    };
    const updating = await renderSettingsDialog(
      <GlobalSettingsAbout
        onExportDiagnostics={vi.fn()}
        activeSection="about"
        appInfo={available}
        error={null}
        isPending={false}
        isUpdatePending
        onRetry={vi.fn()}
        onUpdate={vi.fn()}
        updateProgress={{ percent: 30, phase: "downloading" }}
      />,
    );
    const restartRequired = await renderSettingsDialog(
      <GlobalSettingsAbout
        onExportDiagnostics={vi.fn()}
        activeSection="about"
        appInfo={{
          ...available,
          status: "restart-required",
          updateAvailable: false,
        }}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    const checkFailed = await renderSettingsDialog(
      <GlobalSettingsAbout
        onExportDiagnostics={vi.fn()}
        activeSection="about"
        appInfo={{
          ...available,
          latestVersion: null,
          status: "check-failed",
          updateAvailable: false,
        }}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(updating).toContain("正在更新");
    expect(updating).toContain("正在下载更新包");
    expect(updating).toContain('role="progressbar"');
    expect(updating).toContain('aria-valuenow="30"');
    expect(restartRequired).toContain("更新完成，重启 Codexly 后生效");
    expect(checkFailed).toContain("无法检查更新");
    expect(checkFailed).toContain("检查更新");
  });

  it("renders detailed release notes in a dedicated dialog", async () => {
    const markup = await renderSettingsDialog(
      <AppReleaseNotesDialog
        notes={"### 新增\n\n- 添加在线更新。"}
        onClose={vi.fn()}
        open
        version="1.4.0"
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("1.4.0 更新日志");
    expect(markup).toContain("添加在线更新");
  });

  it("uses the selected model default when the previous effort is unavailable", () => {
    expect(resolveGlobalSettingsModel(models, "gpt-5.6-terra", "high")).toEqual({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
  });

  it("uses GPT-6 Luna as the fallback commit message model", () => {
    expect(createFallbackSettings(models).defaultModel).toBe("gpt-6-luna");
  });

  it("renders official Codex terminology in English without rewriting model data", async () => {
    await changeAppLanguage("en");
    try {
      const markup = await renderSettingsDialog(
        <GlobalSettingsPage
          client={new CodexlyClient()}
          apps={[]}
          error={null}
          isPending={false}
          models={models}
          onClose={vi.fn()}
          onRetry={vi.fn()}
          onSave={vi.fn()}
          settings={{
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            defaultAgent: "codex" as const,
            defaultModel: "gpt-5.6-sol",
            commitMessagePrompt: "",
            modelContextWindow: null,
            defaultOpenAppId: null,
            fastMode: false,
            followUpBehavior: "queue",
            model: "gpt-5.6-sol",
            pet: { enabled: false, selectedPetId: null },
            reasoningEffort: "high",
            sandboxMode: "workspace-write",
          }}
        />,
      );

      expect(markup).toContain("Global settings");
      expect(markup).toContain("General");
      expect(markup).toContain("Personalization");
      expect(markup).toContain("Follow-up messages");
      expect(markup).toContain('aria-label="Language"');
    } finally {
      await changeAppLanguage("zh-CN");
    }
  });
});

it("keeps diagnostic export available when version information fails", async () => {
  const markup = await renderSettingsDialog(
    <GlobalSettingsAbout
      onExportDiagnostics={vi.fn()}
      activeSection="about"
      error={new Error("offline")}
      isPending={false}
      onRetry={vi.fn()}
      onUpdate={vi.fn()}
    />,
  );
  expect(markup).toContain("导出诊断日志");
});
