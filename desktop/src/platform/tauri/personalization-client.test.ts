import manifest from "../../../src-tauri/build.rs?raw";
import handlers from "../../../src-tauri/src/lib.rs?raw";
import permissions from "../../../src-tauri/permissions/window-command-sets.toml?raw";
import { describe, expect, it, vi } from "vitest";
import { TauriCatalogClient } from "./catalog-client.js";
import type { NativeInvoke } from "./native-invoke.js";

describe("personalization native contract", () => {
  it("grants all commands only to the main window", () => {
    for (const command of ["get_global_instructions", "save_global_instructions", "get_memory_settings", "update_memory_settings", "reset_memories"]) {
      expect(manifest).toContain(`"${command}"`);
      expect(handlers).toContain(`personalization_commands::${command}`);
      for (const set of permissions.split("[[set]]").slice(1)) {
        expect(set.includes(`"allow-${command.replaceAll("_", "-")}"`)).toBe(set.includes('identifier = "main-window-commands"'));
      }
    }
  });

  it("preserves instruction content and the expected save baseline across IPC", async () => {
    const result = { content: "  原文\r\n", path: "/custom/AGENTS.md", overrideActive: false };
    const invoke = vi.fn(async () => result);
    const client = new TauriCatalogClient({ ensureRuntime: async () => undefined, invoke: invoke as NativeInvoke });
    expect(await client.saveGlobalInstructions(result.content, "before")).toEqual(result);
    expect(invoke).toHaveBeenCalledWith("save_global_instructions", { content: result.content, expectedContent: "before" });
  });
});
