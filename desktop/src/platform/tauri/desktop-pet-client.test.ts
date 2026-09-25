import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("desktop pet native client", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("configures only the selected pet while Rust owns activity", async () => {
    const { configureDesktopPet } = await import("./desktop-pet-client.js");

    await configureDesktopPet("codex");

    expect(invoke).toHaveBeenCalledWith("configure_desktop_pet", { petId: "codex" });
  });

  it("destroys the native pet window when the feature is disabled", async () => {
    const { configureDesktopPet } = await import("./desktop-pet-client.js");

    await configureDesktopPet(null);

    expect(invoke).toHaveBeenCalledWith("configure_desktop_pet", { petId: null });
  });

  it("uses the native drag session when the runtime can report its release", async () => {
    invoke.mockResolvedValueOnce("native");
    const { getDesktopPetDragStrategy, startDesktopPetNativeDrag } = await import(
      "./desktop-pet-client.js"
    );

    await expect(getDesktopPetDragStrategy()).resolves.toBe("native");
    await startDesktopPetNativeDrag();

    expect(invoke).toHaveBeenNthCalledWith(1, "get_desktop_pet_drag_strategy");
    expect(invoke).toHaveBeenNthCalledWith(2, "start_desktop_pet_native_drag");
  });

  it("keeps frame-coalesced positioning as the non-native fallback", async () => {
    const { setDesktopPetDragPosition } = await import("./desktop-pet-client.js");

    await setDesktopPetDragPosition({ x: 320, y: 480 });

    expect(invoke).toHaveBeenCalledWith("set_desktop_pet_drag_position", { x: 320, y: 480 });
  });

  it("moves the native window for keyboard interaction", async () => {
    const { moveDesktopPet } = await import("./desktop-pet-client.js");

    await moveDesktopPet({ deltaX: -24, deltaY: 0, reset: false });

    expect(invoke).toHaveBeenCalledWith("move_desktop_pet", {
      deltaX: -24,
      deltaY: 0,
      reset: false,
    });
  });

  it("sizes the combined pet WebView to its rendered bubbles", async () => {
    const { layoutDesktopPet } = await import("./desktop-pet-client.js");

    await layoutDesktopPet(96);

    expect(invoke).toHaveBeenCalledWith("layout_desktop_pet", {
      bubbleHeight: 96,
    });
  });

  it("asks the main window to open a task selected from a bubble", async () => {
    const { openDesktopPetTask } = await import("./desktop-pet-client.js");

    await openDesktopPetTask({ projectId: "project-1", taskId: "task-1" });

    expect(invoke).toHaveBeenCalledWith("open_desktop_pet_task", {
      projectId: "project-1",
      taskId: "task-1",
    });
  });
});
