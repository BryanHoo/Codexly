import { expect, it, vi } from "vitest";
import type { AgentGlobalSettings, AgentGlobalSettingsResponse } from "@codexly/protocol";
import {
  engineModelsQuery,
  engineSettingsQuery,
  engineSettingsMutation,
} from "./engine-settings-query.js";

it("routes shared preferences and models to Claude without probing Codex", async () => {
  const models = { data: [], nextCursor: null };
  const response = { settings: {} as AgentGlobalSettings };
  const client = {
    listModels: vi.fn(() => Promise.reject(new Error("Codex unavailable"))),
    getEngineProfile: vi.fn(() => Promise.resolve({ models })),
    getGlobalSettings: vi.fn(() => Promise.resolve(response)),
    updateGlobalSettings: vi.fn(() => Promise.resolve(response)),
  };
  const signal = new AbortController().signal;
  expect(await engineModelsQuery(client, "claude").queryFn({ signal })).toBe(models);
  await engineSettingsQuery(client, "claude").queryFn({ signal });
  await engineSettingsMutation(client, "claude").mutationFn(response.settings);
  expect(client.listModels).not.toHaveBeenCalled();
  expect(client.getEngineProfile).toHaveBeenCalledWith("claude");
  expect(client.getGlobalSettings).toHaveBeenCalledWith({ signal, engine: "claude" });
  expect(client.updateGlobalSettings).toHaveBeenCalledWith(response.settings, { engine: "claude" });
  expect(engineModelsQuery(client, "claude").queryKey).not.toEqual(
    engineModelsQuery(client, "codex").queryKey,
  );
  expect(engineSettingsQuery(client, "claude").queryKey).not.toEqual(
    engineSettingsQuery(client, "codex").queryKey,
  );
});

it("preserves the existing Codex settings calls", async () => {
  const response = { settings: {} as AgentGlobalSettings } satisfies AgentGlobalSettingsResponse;
  const client = {
    getGlobalSettings: vi.fn(() => Promise.resolve(response)),
    updateGlobalSettings: vi.fn(() => Promise.resolve(response)),
  };
  const signal = new AbortController().signal;
  await engineSettingsQuery(client, "codex").queryFn({ signal });
  await engineSettingsMutation(client, "codex").mutationFn(response.settings);
  expect(client.getGlobalSettings).toHaveBeenCalledWith({ signal });
  expect(client.updateGlobalSettings).toHaveBeenCalledWith(response.settings);
});
