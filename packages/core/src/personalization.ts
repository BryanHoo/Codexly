import type {
  AgentPreferences,
  GlobalInstructions,
  MemorySettings,
  MemorySettingsUpdate,
  SaveGlobalInstructions,
} from "@codexly/protocol";

export interface PersonalizationProvider {
  getGlobalInstructions(): Promise<GlobalInstructions>;
  saveGlobalInstructions(input: SaveGlobalInstructions): Promise<GlobalInstructions>;
  getMemorySettings(): Promise<MemorySettings>;
  updateMemorySettings(input: MemorySettingsUpdate): Promise<MemorySettings>;
  resetMemories(): Promise<void>;
  getAgentPreferences(): Promise<AgentPreferences>;
  updateAgentPreferences(input: AgentPreferences): Promise<AgentPreferences>;
}
