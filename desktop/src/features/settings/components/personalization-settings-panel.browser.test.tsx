import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { toast } from "sonner";
import { i18n } from "../../../i18n/i18n.js";
import { PersonalizationSettingsPanel } from "./personalization-settings-panel.js";

function clientFixture() {
  return {
    getGlobalInstructions: vi.fn(async () => ({ content: "# 原有说明\n", path: "/custom/AGENTS.md", overrideActive: false })),
    saveGlobalInstructions: vi.fn(async (content: string, _expectedContent: string) => ({ content, path: "/custom/AGENTS.md", overrideActive: false })),
    getMemorySettings: vi.fn(async () => ({ enabled: false, allowExternalContext: true })),
    updateMemorySettings: vi.fn(async (_update: { enabled?: boolean; allowExternalContext?: boolean }) => ({ enabled: true, allowExternalContext: true })),
    resetMemories: vi.fn(async () => undefined),
  };
}

async function setup(client = clientFixture()) {
  await i18n.changeLanguage("zh-CN");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const screen = await render(<QueryClientProvider client={queryClient}><PersonalizationSettingsPanel client={client} /></QueryClientProvider>);
  return { screen, client };
}

describe("personalization", () => {
  it("loads existing instructions and explicitly saves the untrimmed draft", async () => {
    const success = vi.spyOn(toast, "success");
    const { screen, client } = await setup();
    const editor = screen.getByRole("textbox", { name: "Codex 说明" });
    await expect.element(editor).toHaveValue("# 原有说明\n");
    expect(document.querySelector('label[for="codex-global-instructions"]')?.parentElement).toHaveTextContent("/custom/AGENTS.md");
    await expect.element(screen.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    await editor.fill("  新说明\n");
    expect(client.saveGlobalInstructions).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "保存", exact: true }).click();
    await vi.waitFor(() => expect(client.saveGlobalInstructions).toHaveBeenCalledWith("  新说明\n", "# 原有说明\n"));
    await expect.element(screen.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    expect(success).toHaveBeenCalledWith("已保存");
    success.mockRestore();
  });

  it("updates memory preferences and confirms destructive reset", async () => {
    const success = vi.spyOn(toast, "success");
    const { screen, client } = await setup();
    const toggle = screen.getByRole("switch", { name: "启用本地记忆" });
    await expect.element(toggle).toBeEnabled();
    await toggle.click();
    await vi.waitFor(() => expect(client.updateMemorySettings).toHaveBeenCalledWith({ enabled: true }));
    await screen.getByRole("button", { name: "删除本地记忆", exact: true }).click();
    expect(client.resetMemories).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "确认删除", exact: true }).click();
    await vi.waitFor(() => expect(client.resetMemories).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith("本地记忆已删除"));
    success.mockRestore();
  });

  it("keeps the edited draft when saving fails", async () => {
    const client = clientFixture();
    client.saveGlobalInstructions.mockRejectedValue(new Error("disk unavailable"));
    const { screen } = await setup(client);
    const editor = screen.getByRole("textbox", { name: "Codex 说明" });
    await expect.element(editor).toHaveValue("# 原有说明\n");
    await editor.fill("保留草稿");
    await screen.getByRole("button", { name: "保存", exact: true }).click();
    await expect.element(screen.getByRole("alert")).toBeVisible();
    await expect.element(editor).toHaveValue("保留草稿");
  });
});
