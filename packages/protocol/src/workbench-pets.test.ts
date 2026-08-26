import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { AgentGlobalSettingsSchema } from "./project-settings.js";
import {
  WorkbenchPetCatalogResponseSchema,
  WorkbenchPetDownloadRequestSchema,
  WorkbenchPetSettingsSchema,
} from "./workbench-pets.js";

const descriptor = {
  animations: {
    idle: {
      fallback: "idle",
      frames: [{ durationMs: 1_680, spriteIndex: 0 }],
      loopStart: 0,
    },
  },
  assetId: "a".repeat(64),
  availability: "ready",
  description: "The original Codex companion",
  displayName: "Codex",
  frame: { columns: 8, height: 208, rows: 9, width: 192 },
  id: "codex",
  source: "builtin",
} as const;

describe("workbench pet protocol", () => {
  it("accepts strict catalog and global setting contracts", () => {
    expect(Value.Check(WorkbenchPetCatalogResponseSchema, { data: [descriptor] })).toBe(true);
    expect(Value.Check(WorkbenchPetSettingsSchema, { enabled: false, selectedPetId: null })).toBe(
      true,
    );
    expect(Value.Check(WorkbenchPetSettingsSchema, { enabled: true, selectedPetId: "codex" })).toBe(
      true,
    );
    expect(
      Value.Check(AgentGlobalSettingsSchema, {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        commitMessageModel: "gpt-5.6-luna",
        commitMessagePrompt: "",
        defaultOpenAppId: null,
        fastMode: false,
        followUpBehavior: "queue",
        model: "gpt-5.6-sol",
        pet: { enabled: false, selectedPetId: null },
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      }),
    ).toBe(true);
  });

  it("rejects invalid enabled settings, animation frames, and extra fields", () => {
    expect(Value.Check(WorkbenchPetSettingsSchema, { enabled: true, selectedPetId: null })).toBe(
      false,
    );
    expect(
      Value.Check(WorkbenchPetCatalogResponseSchema, {
        data: [
          {
            ...descriptor,
            animations: {
              idle: {
                fallback: "idle",
                frames: [{ durationMs: 0, spriteIndex: 72 }],
                loopStart: 0,
              },
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      Value.Check(WorkbenchPetCatalogResponseSchema, {
        data: [{ ...descriptor, spritesheetPath: "/private/pet.webp" }],
      }),
    ).toBe(false);
    expect(Value.Check(WorkbenchPetDownloadRequestSchema, { petId: "codex" })).toBe(true);
    expect(
      Value.Check(WorkbenchPetDownloadRequestSchema, {
        petId: "codex",
        url: "https://example.com/pet.webp",
      }),
    ).toBe(false);
  });
});
