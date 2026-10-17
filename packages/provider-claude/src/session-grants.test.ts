import { describe, expect, it } from "vitest";
import { ClaudeSessionGrants, canReplaySessionGrants } from "./session-grants.js";

describe("Claude session grants", () => {
  it("preserves SDK session rule content and directories without duplicates", () => {
    const grants = new ClaudeSessionGrants();
    const updates = [
      {
        type: "addRules" as const,
        rules: [
          { toolName: "Read", ruleContent: "/tmp/my project/**" },
          { toolName: "Bash", ruleContent: "git status:*" },
          { toolName: "WebSearch" },
        ],
        behavior: "allow" as const,
        destination: "session" as const,
      },
      {
        type: "addDirectories" as const,
        directories: ["/tmp/my project"],
        destination: "session" as const,
      },
    ];
    grants.remember(updates);
    grants.remember(updates);
    expect(grants.options()).toEqual({
      allowedTools: ["Read(/tmp/my project/**)", "Bash(git status:*)", "WebSearch"],
      additionalDirectories: ["/tmp/my project"],
    });
    expect(updates[0]).toMatchObject({ destination: "session" });
  });

  it("rejects bypass mode and rule removals as replayable session grants", () => {
    const grants = new ClaudeSessionGrants();
    expect(canReplaySessionGrants([])).toBe(false);
    expect(
      canReplaySessionGrants([
        { type: "setMode", mode: "bypassPermissions", destination: "session" },
      ]),
    ).toBe(false);
    expect(() => {
      grants.remember([
        {
          type: "addRules",
          rules: [{ toolName: "Read", ruleContent: "/tmp/**" }],
          behavior: "allow",
          destination: "session",
        },
        {
          type: "removeRules",
          rules: [{ toolName: "Bash" }],
          behavior: "deny",
          destination: "session",
        },
      ]);
    }).toThrow(/unsupported/i);
    expect(grants.options()).toEqual({ allowedTools: [] });
  });

  it("restores SDK edit approval until the user explicitly changes permission mode", () => {
    const grants = new ClaudeSessionGrants("default");
    grants.remember([{ type: "setMode", mode: "acceptEdits", destination: "session" }]);
    expect(grants.options("default")).toEqual({
      allowedTools: [],
      permissionMode: "acceptEdits",
    });
    expect(grants.options("plan")).toEqual({ allowedTools: [] });
    expect(grants.options("default")).toEqual({ allowedTools: [] });
  });
});
