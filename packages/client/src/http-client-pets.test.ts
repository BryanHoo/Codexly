import { describe, expect, it, vi } from "vitest";

import { buildWorkbenchPetAssetUrl, CodexlyClient, CodexlyResponseError } from "./http-client.js";
import { jsonResponse } from "./http-client.test-support.js";

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

describe("CodexlyClient workbench pets", () => {
  it("reads and downloads pets through decoded contracts", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [descriptor] }))
      .mockResolvedValueOnce(jsonResponse({ data: descriptor }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.listWorkbenchPets()).resolves.toEqual({ data: [descriptor] });
    await expect(
      client.downloadWorkbenchPet("codex", { idempotencyKey: "download-codex" }),
    ).resolves.toEqual({ data: descriptor });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/v1/pets", "/v1/pets/downloads"]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ petId: "codex" }),
      method: "POST",
    });
    expect(buildWorkbenchPetAssetUrl("pet/id", "http://127.0.0.1:3210/")).toBe(
      "http://127.0.0.1:3210/v1/pets/assets/pet%2Fid",
    );
  });

  it("rejects a catalog response that bypasses the protocol", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ data: [{ ...descriptor, spritesheetPath: "/private/pet.webp" }] }),
      );
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.listWorkbenchPets()).rejects.toBeInstanceOf(CodexlyResponseError);
  });
});
