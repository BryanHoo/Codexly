import type { WorkbenchPetDescriptor } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";

import { createCodexlyServer } from "./app.js";
import { createServerOptions } from "./app-options.test-support.js";
import { createProvider } from "./app-provider.test-support.js";
import { closeCallbacks } from "./app.test-support.js";

const descriptor: WorkbenchPetDescriptor = {
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
};

function createPetProvider() {
  return {
    ensurePetAsset: vi.fn(() => Promise.resolve(descriptor)),
    listPets: vi.fn(() => Promise.resolve([descriptor])),
    openPetAsset: vi.fn((assetId: string) =>
      Promise.resolve(
        assetId === descriptor.assetId
          ? {
              content: Uint8Array.from([82, 73, 70, 70]),
              contentType: "image/webp" as const,
              etag: 'W/"4-1000"',
              size: 4,
            }
          : undefined,
      ),
    ),
  };
}

describe("workbench pet routes", () => {
  it("serves the catalog and conditionally cached assets with safe headers", async () => {
    const petProvider = createPetProvider();
    const app = await createCodexlyServer(
      createServerOptions(createProvider().provider, { petProvider }),
    );
    closeCallbacks.push(() => app.close());

    const catalog = await app.inject({ method: "GET", url: "/v1/pets" });
    const asset = await app.inject({
      method: "GET",
      url: `/v1/pets/assets/${descriptor.assetId}`,
    });
    const unchanged = await app.inject({
      headers: { "if-none-match": 'W/"4-1000"' },
      method: "GET",
      url: `/v1/pets/assets/${descriptor.assetId}`,
    });

    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toEqual({ data: [descriptor] });
    expect(asset.statusCode).toBe(200);
    expect(asset.rawPayload).toEqual(Buffer.from([82, 73, 70, 70]));
    expect(asset.headers).toMatchObject({
      "cache-control": "private, no-cache",
      "content-type": "image/webp",
      "cross-origin-resource-policy": "same-origin",
      etag: 'W/"4-1000"',
      "x-content-type-options": "nosniff",
    });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.rawPayload).toHaveLength(0);
  });

  it("requires an idempotency key and maps download failures", async () => {
    const petProvider = createPetProvider();
    petProvider.ensurePetAsset.mockRejectedValueOnce(new Error("CDN unavailable"));
    const app = await createCodexlyServer(
      createServerOptions(createProvider().provider, { petProvider }),
    );
    closeCallbacks.push(() => app.close());

    const missingKey = await app.inject({
      method: "POST",
      payload: { petId: "codex" },
      url: "/v1/pets/downloads",
    });
    const failed = await app.inject({
      headers: { "idempotency-key": "download-codex" },
      method: "POST",
      payload: { petId: "codex" },
      url: "/v1/pets/downloads",
    });

    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({
      code: "PET_DOWNLOAD_FAILED",
      message: "Pet asset download failed",
      retryable: true,
    });
  });

  it("protects every pet route in LAN mode", async () => {
    const app = await createCodexlyServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code" },
        petProvider: createPetProvider(),
      }),
    );
    closeCallbacks.push(() => app.close());

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/v1/pets" }),
      app.inject({ method: "GET", url: `/v1/pets/assets/${descriptor.assetId}` }),
      app.inject({
        headers: { "idempotency-key": "download-codex" },
        method: "POST",
        payload: { petId: "codex" },
        url: "/v1/pets/downloads",
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401]);
  });
});
