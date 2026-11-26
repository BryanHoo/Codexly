import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalWorkbenchPetProvider } from "./workbench-pets.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("Codex workbench pets", () => {
  it("lists all builtins and lets pets override legacy avatars with the same folder", async () => {
    const assetHome = await createCodexHome();
    await writeCustomPet(assetHome, "avatars", "chefito", "Legacy Chefito");
    await writeCustomPet(assetHome, "pets", "chefito", "Chefito");

    const provider = createLocalWorkbenchPetProvider({ assetHome });
    const pets = await provider.listPets();

    expect(pets.filter((pet) => pet.source === "builtin")).toHaveLength(8);
    expect(pets.find((pet) => pet.id === "codex")?.availability).toBe("downloadable");
    expect(pets.filter((pet) => pet.id === "custom:chefito")).toEqual([
      expect.objectContaining({
        availability: "ready",
        displayName: "Chefito",
        source: "custom",
      }),
    ]);
    expect(JSON.stringify(pets)).not.toContain(assetHome);
  });

  it("discovers PNG custom pets and serves their declared image type", async () => {
    const assetHome = await createCodexHome();
    const directory = join(assetHome, "pets", "ubuntu-pet");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "pet.json"),
      JSON.stringify({ displayName: "Ubuntu Pet", spritesheetPath: "spritesheet.png" }),
    );
    await writeFile(join(directory, "spritesheet.png"), createPngDimensions(1_536, 1_872));

    const provider = createLocalWorkbenchPetProvider({ assetHome });
    const pets = await provider.listPets();
    const pet = pets.find((candidate) => candidate.id === "custom:ubuntu-pet");

    expect(pet).toEqual(
      expect.objectContaining({ availability: "ready", displayName: "Ubuntu Pet" }),
    );
    await expect(provider.openPetAsset(pet?.assetId ?? "")).resolves.toEqual(
      expect.objectContaining({ contentType: "image/png" }),
    );
  });

  it("discovers sprite version 2 pets with an 8 by 11 frame grid", async () => {
    const assetHome = await createCodexHome();
    const directory = join(assetHome, "pets", "mu");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "pet.json"),
      JSON.stringify({
        displayName: "MU",
        spriteVersionNumber: 2,
        spritesheetPath: "spritesheet.webp",
      }),
    );
    await writeFile(join(directory, "spritesheet.webp"), createWebpDimensions(1_536, 2_288));

    const provider = createLocalWorkbenchPetProvider({ assetHome });
    const pets = await provider.listPets();

    expect(pets.find((candidate) => candidate.id === "custom:mu")).toEqual(
      expect.objectContaining({
        availability: "ready",
        displayName: "MU",
        frame: { columns: 8, height: 208, rows: 11, width: 192 },
      }),
    );
  });

  it("skips path escapes and rejects asset identifiers outside the discovered catalog", async () => {
    const assetHome = await createCodexHome();
    const directory = join(assetHome, "pets", "unsafe");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "pet.json"),
      JSON.stringify({ displayName: "Unsafe", spritesheetPath: "../outside.webp" }),
    );
    await writeFile(join(assetHome, "pets", "outside.webp"), createWebpDimensions(1_536, 1_872));

    const provider = createLocalWorkbenchPetProvider({ assetHome });

    await expect(provider.listPets()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "custom:unsafe" })]),
    );
    await expect(provider.openPetAsset("f".repeat(64))).resolves.toBeUndefined();
  });

  it("deduplicates concurrent builtin downloads and reuses the validated cache", async () => {
    const assetHome = await createCodexHome();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(createWebpDimensions(1_536, 1_872), {
        headers: { "content-type": "image/webp" },
        status: 200,
      }),
    );
    const provider = createLocalWorkbenchPetProvider({ assetHome, fetch: fetchMock });

    const [first, second] = await Promise.all([
      provider.ensurePetAsset("codex"),
      provider.ensurePetAsset("codex"),
    ]);
    const third = await provider.ensurePetAsset("codex");

    expect(first).toEqual(second);
    expect(third.availability).toBe("ready");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [downloadUrl, downloadOptions] = fetchMock.mock.calls[0] ?? [];
    expect(downloadUrl).toBe(
      "https://persistent.oaistatic.com/codex/pets/v1/codex-spritesheet-v4.webp",
    );
    expect(downloadOptions).toMatchObject({ redirect: "follow" });
    expect(downloadOptions?.signal).toBeInstanceOf(AbortSignal);
    await expect(provider.openPetAsset(first.assetId)).resolves.toEqual(
      expect.objectContaining({ contentType: "image/webp", size: 30 }),
    );
  });

  it("rejects unknown and custom download ids without issuing requests", async () => {
    const assetHome = await createCodexHome();
    const fetchMock = vi.fn<typeof fetch>();
    const provider = createLocalWorkbenchPetProvider({ assetHome, fetch: fetchMock });

    await expect(provider.ensurePetAsset("custom:chefito")).rejects.toThrow(
      "Only built-in pets can be downloaded",
    );
    await expect(provider.ensurePetAsset("unknown")).rejects.toThrow("Unknown built-in pet");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function createCodexHome(): Promise<string> {
  const assetHome = await mkdtemp(join(tmpdir(), "codexly-pets-"));
  temporaryDirectories.push(assetHome);
  return assetHome;
}

async function writeCustomPet(
  assetHome: string,
  root: "avatars" | "pets",
  id: string,
  displayName: string,
): Promise<void> {
  const directory = join(assetHome, root, id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, root === "pets" ? "pet.json" : "avatar.json"),
    JSON.stringify({ displayName, spritesheetPath: "spritesheet.webp" }),
  );
  await writeFile(join(directory, "spritesheet.webp"), createWebpDimensions(1_536, 1_872));
}

// VP8X 只保存画布尺寸，足以让成熟图片解析器验证 WebP 几何信息。
function createWebpDimensions(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 22, true);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
  view.setUint32(16, 10, true);
  writeUint24(bytes, 24, width - 1);
  writeUint24(bytes, 27, height - 1);
  return bytes;
}

// PNG 尺寸位于 IHDR 固定字段，足以覆盖目录扫描所需的格式与几何校验。
function createPngDimensions(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function writeUint24(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
}
