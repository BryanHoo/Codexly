import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { i18n } from "../../../i18n/i18n.js";
import "../../../i18n/settings-general.js";
import { TemporaryWorkspaceSettingsField } from "./temporary-workspace-settings-field.js";
import { createActionMutationCache } from "../../notifications/action-notifications.js";
import { toast } from "sonner";

const commands = vi.hoisted(() => ({ get: vi.fn(), choose: vi.fn() }));
vi.mock("@/platform/tauri/temporary-workspace-client.js", () => ({ getTemporaryWorkspaceSettings: commands.get, chooseTemporaryWorkspaceRoot: commands.choose }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("TemporaryWorkspaceSettingsField", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage("zh-CN");
    commands.get.mockResolvedValue({ rootPath: "/tasks/original" });
  });

  async function mount() {
    const client = new QueryClient({ mutationCache: createActionMutationCache(), defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const screen = await render(<QueryClientProvider client={client}><TemporaryWorkspaceSettingsField /></QueryClientProvider>);
    await expect.element(screen.getByText("/tasks/original")).toBeVisible();
    return screen;
  }

  it("keeps cancelled selections and shows only successfully saved paths", async () => {
    const screen = await mount();
    commands.choose.mockResolvedValueOnce(null).mockResolvedValueOnce({ rootPath: "/tasks/selected" });
    await screen.getByRole("button", { name: "更改" }).click();
    await expect.element(screen.getByText("/tasks/original")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "更改" })).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "更改" }).click();
    await expect.element(screen.getByText("/tasks/selected")).toBeVisible();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("keeps the saved path and permits retry after a write failure", async () => {
    const screen = await mount();
    commands.choose.mockRejectedValueOnce(new Error("not writable"));
    await screen.getByRole("button", { name: "更改" }).click();
    await expect.element(screen.getByRole("alert")).toBeVisible();
    await expect.element(screen.getByText("/tasks/original")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "更改" })).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
