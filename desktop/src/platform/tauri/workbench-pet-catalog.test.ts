import { describe, expect, it, vi } from "vitest";

import type { InvokeImplementation } from "./native-client.js";
import { TauriRuntimeClient } from "./runtime-client.js";
import { mapNativePet } from "./workbench-pet-catalog.js";

describe("native workbench pet catalog", () => {
  it("maps ready assets and routes downloads through Tauri", async () => {
    const assetId = "a".repeat(64);
    const ready = {
      assetId,
      assetPath: "/tmp/codex-spritesheet-v4.webp",
      availability: "ready" as const,
      id: "codex",
      source: "builtin" as const,
    };
    const invoke = vi.fn(async (command: string) =>
      command === "list_workbench_pets" ? { data: [ready] } : { data: ready },
    );
    const client = new TauriRuntimeClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    const catalog = await client.listWorkbenchPets();
    expect(catalog.data[0]).toMatchObject({
      animations: { idle: { fallback: "idle", loopStart: 0 } },
      assetId,
      assetPath: ready.assetPath,
      availability: "ready",
      frame: { columns: 8, height: 208, rows: 9, width: 192 },
      id: "codex",
      source: "builtin",
    });
    await expect(client.downloadWorkbenchPet("codex")).resolves.toMatchObject({
      data: { assetPath: ready.assetPath, availability: "ready", id: "codex" },
    });
    expect(invoke.mock.calls).toEqual([
      ["list_workbench_pets"],
      ["download_workbench_pet", { petId: "codex" }],
    ]);
  });

  it("maps validated custom animation overrides", () => {
    const pet = mapNativePet({
      animations: { idle: { fps: 10, frames: [0, 1], loop: false } },
      assetId: "b".repeat(64),
      assetPath: "/tmp/custom.webp",
      availability: "ready",
      description: "Custom",
      displayName: "Chef",
      frame: { columns: 2, height: 16, rows: 1, width: 16 },
      id: "custom:chef",
      source: "custom",
    });

    expect(pet.animations.idle).toMatchObject({
      fallback: "idle",
      frames: [
        { durationMs: 100, spriteIndex: 0 },
        { durationMs: 100, spriteIndex: 1 },
      ],
      loopStart: null,
    });
    expect(pet).toMatchObject({ displayName: "Chef", source: "custom" });
  });
});
