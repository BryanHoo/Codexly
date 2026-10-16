import { expect, it } from "vitest";
import { isManagedClaudeCommand, isSupportedClaudeCommand } from "./commands.js";
it("keeps configuration and session identity commands out of the chat command surface", () => {
  for (const name of ["login", "clear", "resume", "model", "config", "effort", "fast", "goal"]) {
    expect(isSupportedClaudeCommand(name)).toBe(false);
    expect(isManagedClaudeCommand(`/${name} value`)).toBe(true);
  }
  expect(isManagedClaudeCommand("Explain /login in this document")).toBe(false);
  expect(isSupportedClaudeCommand("compact")).toBe(true);
  expect(isSupportedClaudeCommand("my-plugin:review")).toBe(true);
});
