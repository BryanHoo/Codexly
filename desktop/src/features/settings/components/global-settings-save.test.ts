import { describe, expect, it, vi } from "vitest";

import type { AgentGlobalSettings } from "@/protocol/index.js";

import {
  createGlobalSettingsSaveQueue,
  SETTINGS_INPUT_DEBOUNCE_MS,
} from "./global-settings-save.js";

const globalSettings: AgentGlobalSettings = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  commitMessageModel: "gpt-5.6-luna",
  commitMessagePrompt: "",
  defaultOpenAppId: null,
  fastMode: false,
  followUpBehavior: "queue",
  webSearch: "cached",
  modelVerbosity: null,
  model: "gpt-5.6-sol",
  pet: { enabled: false, selectedPetId: null },
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
};

describe("createGlobalSettingsSaveQueue", () => {
  it("should skip an unchanged snapshot", async () => {
    const saveSettings = vi.fn();
    const queue = createGlobalSettingsSaveQueue(saveSettings);
    queue.reset(globalSettings);

    await queue.flush(globalSettings);

    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("should debounce text input and persist only its latest snapshot", async () => {
    vi.useFakeTimers();
    const saveSettings = vi.fn(async () => undefined);
    const queue = createGlobalSettingsSaveQueue(saveSettings);
    queue.reset(globalSettings);

    queue.schedule(
      { ...globalSettings, commitMessagePrompt: "first" },
      SETTINGS_INPUT_DEBOUNCE_MS,
    );
    queue.schedule(
      { ...globalSettings, commitMessagePrompt: "latest" },
      SETTINGS_INPUT_DEBOUNCE_MS,
    );
    await vi.advanceTimersByTimeAsync(SETTINGS_INPUT_DEBOUNCE_MS);
    await queue.flush();

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith({
      ...globalSettings,
      commitMessagePrompt: "latest",
    });
    vi.useRealTimers();
  });

  it("should coalesce changes that arrive while a save is running", async () => {
    let releaseFirstSave: () => void = () => undefined;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const savedModels: string[] = [];
    const saveSettings = vi.fn(async (settings: AgentGlobalSettings) => {
      savedModels.push(settings.model);
      if (savedModels.length === 1) await firstSave;
    });
    const queue = createGlobalSettingsSaveQueue(saveSettings);
    queue.reset(globalSettings);

    queue.save({ ...globalSettings, model: "first" });
    queue.save({ ...globalSettings, model: "skipped" });
    queue.save({ ...globalSettings, model: "latest" });
    releaseFirstSave();
    await queue.flush();

    expect(savedModels).toEqual(["first", "latest"]);
  });
});
