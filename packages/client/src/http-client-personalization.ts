import {
  AgentPreferencesSchema,
  GlobalInstructionsSchema,
  MemorySettingsSchema,
  PersonalizationResetSchema,
  type AgentPreferences,
  type MemorySettingsUpdate,
} from "@codexly/protocol";
import { ScheduledTaskHttpClient } from "./http-client-scheduled-tasks.js";
import type { MutationOptions, ReadOptions } from "./http-client-transport.js";

export class PersonalizationHttpClient extends ScheduledTaskHttpClient {
  listWorkbenchBackgrounds(options: ReadOptions = {}) {
    return this.read("/v1/workbench-background/bing/catalog", BingWallpaperCatalogSchema, options);
  }
  getGlobalInstructions(options: ReadOptions = {}) {
    return this.read("/v1/personalization/instructions", GlobalInstructionsSchema, options);
  }
  saveGlobalInstructions(content: string, expectedContent: string, options: MutationOptions = {}) {
    return this.mutation(
      "/v1/personalization/instructions",
      { content, expectedContent },
      GlobalInstructionsSchema,
      options,
      "PUT",
    );
  }
  getMemorySettings(options: ReadOptions = {}) {
    return this.read("/v1/personalization/memories", MemorySettingsSchema, options);
  }
  updateMemorySettings(input: MemorySettingsUpdate, options: MutationOptions = {}) {
    return this.mutation(
      "/v1/personalization/memories",
      input,
      MemorySettingsSchema,
      options,
      "PUT",
    );
  }
  resetMemories(options: MutationOptions = {}) {
    return this.mutation(
      "/v1/personalization/memories/reset",
      {},
      PersonalizationResetSchema,
      options,
    );
  }
  getAgentPreferences(options: ReadOptions = {}) {
    return this.read("/v1/personalization/agent", AgentPreferencesSchema, options);
  }
  updateAgentPreferences(input: AgentPreferences, options: MutationOptions = {}) {
    return this.mutation(
      "/v1/personalization/agent",
      input,
      AgentPreferencesSchema,
      options,
      "PUT",
    );
  }
}
import { BingWallpaperCatalogSchema } from "@codexly/protocol";
