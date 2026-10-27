import type { AppInfoResponse } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";
import { page } from "vitest/browser";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { GlobalSettingsAbout } from "./global-settings-about.js";
import "../../../shared/styles/globals.css";

const appInfo = {
  appVersion: "0.1.0",
  changelogUrl: "https://github.com/BryanHoo/Codexly/blob/main/CHANGELOG.md",
  codexVersion: "0.163.0",
  latestVersion: null,
  releaseNotes: "## [0.1.0] - 2026-08-31",
  releaseNotesVersion: "0.1.0",
  repositoryUrl: "https://github.com/BryanHoo/Codexly",
  status: "current",
  updateAvailable: false,
} satisfies AppInfoResponse;

describe("GlobalSettingsAbout", () => {
  it.each([480, 1440])("检查完成后在原检查按钮位置再次点击不会安装更新（宽度 %s）", async (width) => {
    await page.viewport(width, 900);
    await i18n.changeLanguage("zh-CN");
    const onUpdate = vi.fn(async () => undefined);
    function Harness() {
      const [info, setInfo] = useState<AppInfoResponse>(appInfo);
      return <I18nextProvider i18n={i18n}><GlobalSettingsAbout
        activeSection="about" appInfo={info} error={null} isPending={false}
        onRetry={async () => { setInfo({ ...appInfo, latestVersion: "0.42.0", status: "available", updateAvailable: true }); }}
        onExportDiagnostics={vi.fn(async () => ({ status: "cancelled" as const }))}
        onUpdate={onUpdate}
      /></I18nextProvider>;
    }
    const screen = await render(<Harness />);
    const check = screen.getByRole("button", { name: "检查更新" });
    const before = check.element().getBoundingClientRect();
    const row = screen.getByText("软件更新", { exact: true }).element().parentElement!.parentElement!;
    // 用真实边界验证右对齐，避免仅检查类名而漏掉满宽容器内部仍然靠左的回归。
    expect(Math.abs(before.right - row.getBoundingClientRect().right)).toBeLessThan(1);
    await check.click();
    await expect.element(screen.getByRole("button", { name: "更新到 0.42.0" })).toBeVisible();
    expect(check.element().getBoundingClientRect().x).toBe(before.x);
    expect(Math.abs(check.element().getBoundingClientRect().right - row.getBoundingClientRect().right)).toBeLessThan(1);
    const nextTarget = document.elementFromPoint(before.x + before.width / 2, before.y + before.height / 2);
    // 模拟用户连续点同一位置，而不是重新按新文案定位按钮。
    (nextTarget?.closest("button") as HTMLButtonElement | null)?.click();
    await Promise.resolve();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("shows a GitHub connection error and allows retry", async () => {
    await i18n.changeLanguage("zh-CN");
    const onRetry = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <GlobalSettingsAbout
          activeSection="about"
          appInfo={{ ...appInfo, status: "connection-failed" }}
          error={null}
          isPending={false}
          onRetry={onRetry}
          onExportDiagnostics={vi.fn(async () => ({ status: "cancelled" as const }))}
          onUpdate={vi.fn()}
        />
      </I18nextProvider>,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("无法连接到GitHub");
    await screen.getByRole("button", { name: "检查更新" }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps release notes available and links to the project changelog", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <GlobalSettingsAbout
          activeSection="about"
          appInfo={appInfo}
          error={null}
          isPending={false}
          onRetry={vi.fn()}
          onExportDiagnostics={vi.fn(async () => ({ status: "cancelled" as const }))}
          onUpdate={vi.fn()}
        />
      </I18nextProvider>,
    );

    expect(screen.getByRole("link", { name: /BryanHoo\/Codexly/ })).toHaveAttribute(
      "href",
      appInfo.repositoryUrl,
    );
    await screen.getByRole("button", { name: "更新日志" }).click();
    expect(screen.getByRole("dialog")).toHaveTextContent("0.1.0 更新日志");
    expect(screen.getByRole("link", { name: "更多" })).toHaveAttribute(
      "href",
      appInfo.changelogUrl,
    );
  });

  it("installs an available update and renders download progress", async () => {
    await i18n.changeLanguage("zh-CN");
    let reportProgress:
      | ((progress: { downloadedBytes: number; sequence: number; totalBytes: number | null }) => void)
      | undefined;
    const onUpdate = vi.fn(
      async (
        _version: string,
        onProgress: (progress: {
          downloadedBytes: number;
          sequence: number;
          totalBytes: number | null;
        }) => void,
      ) => {
        reportProgress = onProgress;
        await new Promise(() => undefined);
      },
    );
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <GlobalSettingsAbout
          activeSection="about"
          appInfo={{
            ...appInfo,
            latestVersion: "0.2.0",
            status: "available",
            updateAvailable: true,
          }}
          error={null}
          isPending={false}
          onRetry={vi.fn()}
          onExportDiagnostics={vi.fn(async () => ({ status: "cancelled" as const }))}
          onUpdate={onUpdate}
        />
      </I18nextProvider>,
    );

    await screen.getByRole("button", { name: "更新到 0.2.0" }).click();
    reportProgress?.({ downloadedBytes: 50, sequence: 1, totalBytes: 100 });

    await expect.element(screen.getByRole("button", { name: "正在下载 50%" })).toBeVisible();
    expect(onUpdate).toHaveBeenCalledWith("0.2.0", expect.any(Function));
  });

  it("exports a diagnostic archive from the about panel", async () => {
    await i18n.changeLanguage("zh-CN");
    const onExportDiagnostics = vi.fn(async () => ({
      fileName: "codexly-diagnostics.zip",
      status: "saved" as const,
    }));
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <GlobalSettingsAbout
          activeSection="about"
          appInfo={appInfo}
          error={null}
          isPending={false}
          onExportDiagnostics={onExportDiagnostics}
          onRetry={vi.fn()}
          onUpdate={vi.fn()}
        />
      </I18nextProvider>,
    );

    await screen.getByRole("button", { name: "导出诊断日志" }).click();
    expect(onExportDiagnostics).toHaveBeenCalledOnce();
  });

  it("keeps diagnostic export available when version information fails", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <GlobalSettingsAbout
          activeSection="about"
          error={new Error("version unavailable")}
          isPending={false}
          onExportDiagnostics={vi.fn(async () => ({ status: "cancelled" as const }))}
          onRetry={vi.fn()}
          onUpdate={vi.fn()}
        />
      </I18nextProvider>,
    );

    await expect.element(screen.getByRole("button", { name: "导出诊断日志" })).toBeVisible();
  });
});
