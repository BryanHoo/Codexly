import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useWorkbenchBackgroundDraft } from "./use-workbench-background-draft.js";
import { DEFAULT_WORKBENCH_BACKGROUND } from "../workbench-background-preference.js";

const storage = vi.hoisted(() => ({ listNativeCustomBackgrounds: vi.fn(), updateNativeCustomBackgrounds: vi.fn(), getItem: vi.fn(), setItem: vi.fn() }));
vi.mock("../../../platform/tauri/app-storage.js", () => ({ appPreferenceStorage: { getItem: storage.getItem, setItem: storage.setItem }, listNativeCustomBackgrounds: storage.listNativeCustomBackgrounds, updateNativeCustomBackgrounds: storage.updateNativeCustomBackgrounds }));
vi.mock("../../../platform/native-asset-url.js", () => ({ buildNativeAssetUrl: (path: string) => path }));

function Harness() {
  const draft = useWorkbenchBackgroundDraft();
  return <><button disabled={draft.isLoading || draft.isSavingImages} onClick={() => draft.removeCustomBackgroundImage("image-1")}>delete</button><button onClick={() => draft.setBackground({ ...draft.background, overlayOpacity: 37 })}>adjust</button><output>{draft.background.mode}:{draft.background.overlayOpacity}:{draft.customImages.length}</output></>;
}

describe("wallpaper persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getItem.mockReturnValue(JSON.stringify({ ...DEFAULT_WORKBENCH_BACKGROUND, mode: "custom", selectedCustomImageId: "image-1", version: 3 }));
    storage.listNativeCustomBackgrounds.mockResolvedValue([{ id: "image-1", name: "landscape.jpg", assetPath: "/image.jpg", createdAt: 0, mediaType: "image/jpeg" }]);
    storage.updateNativeCustomBackgrounds.mockResolvedValue(undefined);
  });

  it("persists deleting the last image and keeps adjustments made during deletion", async () => {
    let finish!: () => void;
    storage.updateNativeCustomBackgrounds.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const screen = await render(<Harness />);
    await expect.element(screen.getByRole("button", { name: "delete" })).toBeEnabled();
    await screen.getByRole("button", { name: "delete" }).click();
    await screen.getByRole("button", { name: "adjust" }).click();
    expect(storage.setItem).toHaveBeenCalledWith("codeagent.workbench-background-preference", expect.stringContaining('"overlayOpacity":37'));
    finish();
    await expect.element(screen.getByText("none:37:0")).toBeVisible();
    expect(storage.updateNativeCustomBackgrounds).toHaveBeenCalledWith(["image-1"], []);
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string)).toMatchObject({ mode: "none", selectedCustomImageId: null, overlayOpacity: 37 });
  });
});
