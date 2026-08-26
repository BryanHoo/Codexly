import { QueryClient } from "@tanstack/react-query";
import type { WorkbenchPetDescriptor } from "@codexly/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { mergeDownloadedPet, petCatalogQueryKey } from "../pet-catalog-query.js";
import { GlobalSettingsPetsView, resolveEnabledPetSettings } from "./global-settings-pets.js";

const codexPet: WorkbenchPetDescriptor = {
  animations: {
    idle: {
      fallback: "idle",
      frames: [{ durationMs: 150, spriteIndex: 0 }],
      loopStart: 0,
    },
  },
  assetId: "a".repeat(64),
  availability: "downloadable",
  description: "The Codex desktop pet.",
  displayName: "Codex",
  frame: { columns: 8, height: 208, rows: 9, width: 192 },
  id: "codex",
  source: "builtin",
};

describe("GlobalSettingsPets", () => {
  it("启用时默认选择 codex，并保留关闭前的选择", () => {
    expect(resolveEnabledPetSettings({ enabled: false, selectedPetId: null }, [codexPet])).toEqual({
      enabled: true,
      selectedPetId: "codex",
    });
    expect(
      resolveEnabledPetSettings({ enabled: false, selectedPetId: "custom" }, [
        codexPet,
        { ...codexPet, id: "custom", source: "custom" },
      ]),
    ).toEqual({ enabled: true, selectedPetId: "custom" });
  });

  it("下载成功后只替换目标宠物并写回目录缓存", () => {
    const queryClient = new QueryClient();
    const other = { ...codexPet, assetId: "b".repeat(64), id: "dewey" };
    const ready = { ...codexPet, availability: "ready" as const };
    queryClient.setQueryData(petCatalogQueryKey, { data: [codexPet, other] });

    queryClient.setQueryData(
      petCatalogQueryKey,
      mergeDownloadedPet(queryClient.getQueryData(petCatalogQueryKey), ready),
    );

    expect(queryClient.getQueryData(petCatalogQueryKey)).toEqual({ data: [ready, other] });
  });

  it("展示启用开关、可下载状态和刷新入口", async () => {
    await changeAppLanguage("zh-CN");
    const markup = renderToStaticMarkup(
      <GlobalSettingsPetsView
        error={null}
        isLoading={false}
        onEnabledChange={vi.fn()}
        onPetSelect={vi.fn()}
        onRefresh={vi.fn()}
        pets={[codexPet]}
        settings={{ enabled: false, selectedPetId: null }}
      />,
    );

    expect(markup).toContain("启用工作台宠物");
    expect(markup).toContain("Codex");
    expect(markup).toContain("需要下载");
    expect(markup).toContain("刷新列表");
  });

  it("未选中的已就绪宠物也直接展示预览", async () => {
    await changeAppLanguage("zh-CN");
    const markup = renderToStaticMarkup(
      <GlobalSettingsPetsView
        error={null}
        isLoading={false}
        onEnabledChange={vi.fn()}
        onPetSelect={vi.fn()}
        onRefresh={vi.fn()}
        pets={[{ ...codexPet, availability: "ready" }]}
        settings={{ enabled: false, selectedPetId: null }}
      />,
    );

    expect(markup).toContain("<canvas");
  });

  it("下载失败后保留目录以便切换或重试", async () => {
    await changeAppLanguage("zh-CN");
    const markup = renderToStaticMarkup(
      <GlobalSettingsPetsView
        error={new Error("download failed")}
        isLoading={false}
        onEnabledChange={vi.fn()}
        onPetSelect={vi.fn()}
        onRefresh={vi.fn()}
        pets={[codexPet]}
        settings={{ enabled: true, selectedPetId: "codex" }}
      />,
    );

    expect(markup).toContain("无法加载宠物资源，请重试");
    expect(markup).toContain("Codex");
  });
});
