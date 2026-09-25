import { Value } from "@sinclair/typebox/value";
import { TemporaryWorkspaceSettingsSchema, type TemporaryWorkspaceSettings } from "@/protocol/temporary-workspace.js";
import { invoke } from "./native-invoke.js";

function parseSettings(value: unknown): TemporaryWorkspaceSettings {
  if (!Value.Check(TemporaryWorkspaceSettingsSchema, value)) throw new Error("INVALID_TEMPORARY_WORKSPACE_SETTINGS");
  return value;
}

export async function getTemporaryWorkspaceSettings(): Promise<TemporaryWorkspaceSettings> {
  return parseSettings(await invoke("get_temporary_workspace_settings"));
}

export async function chooseTemporaryWorkspaceRoot(): Promise<TemporaryWorkspaceSettings | null> {
  const value = await invoke("choose_temporary_workspace_root");
  return value === null ? null : parseSettings(value);
}
