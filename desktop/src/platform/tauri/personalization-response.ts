import { Value } from "@sinclair/typebox/value";
import { GlobalInstructionsSchema, MemorySettingsSchema, type GlobalInstructions, type MemorySettings } from "@/protocol/index.js";

// 响应校验按需加载，避免为工作台首屏引入设置专用的运行时校验代码。
export function parseInstructions(value: unknown): GlobalInstructions {
  if (!Value.Check(GlobalInstructionsSchema, value)) throw new Error("INVALID_GLOBAL_INSTRUCTIONS");
  return value;
}

export function parseMemories(value: unknown): MemorySettings {
  if (!Value.Check(MemorySettingsSchema, value)) throw new Error("INVALID_MEMORY_SETTINGS");
  return value;
}
