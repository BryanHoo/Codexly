import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  WorkbenchPetProviderError,
  type WorkbenchPetAsset,
  type WorkbenchPetProvider,
} from "@codexly/core";
import type { WorkbenchPetDescriptor } from "@codexly/protocol";
import {
  BUILTIN_PETS,
  createBuiltinDescriptor,
  PET_CDN_BASE_URL,
  PET_PACK_VERSION,
  PET_SPRITESHEET,
  type BuiltinPet,
} from "./workbench-pet-catalog.js";
import { readWebpDimensions, readWebpDimensionsFromFile } from "./workbench-pet-image.js";
import { loadCustomPet, validatePetAsset, type PetAssetRecord } from "./workbench-pet-manifest.js";

const MAX_DOWNLOAD_BYTES = 4 * 1_024 * 1_024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_DOWNLOADS = 2;

export type CreateCodexWorkbenchPetProviderOptions = Readonly<{
  codexHome: string;
  fetch?: typeof globalThis.fetch;
  logger?: Readonly<{ warn(message: string): void }>;
}>;

export class CodexWorkbenchPetProvider implements WorkbenchPetProvider {
  readonly #assetRecords = new Map<string, PetAssetRecord>();
  readonly #codexHome: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #inFlight = new Map<string, Promise<WorkbenchPetDescriptor>>();
  readonly #logger: Readonly<{ warn(message: string): void }> | undefined;
  readonly #downloadWaiters: (() => void)[] = [];
  #activeDownloads = 0;

  public constructor(options: CreateCodexWorkbenchPetProviderOptions) {
    this.#codexHome = resolve(options.codexHome);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#logger = options.logger;
  }

  public async listPets(): Promise<readonly WorkbenchPetDescriptor[]> {
    this.#assetRecords.clear();
    const builtins = await Promise.all(BUILTIN_PETS.map((pet) => this.#describeBuiltin(pet)));
    const preferred = await this.#scanCustomRoot("pets", "pet.json", "custom");
    const preferredFolders = new Set(preferred.map((record) => record.descriptor.id));
    const legacy = (await this.#scanCustomRoot("avatars", "avatar.json", "legacy")).filter(
      (record) => !preferredFolders.has(record.descriptor.id),
    );
    for (const record of [...preferred, ...legacy]) this.#assetRecords.set(record.assetId, record);
    return [...builtins, ...preferred, ...legacy].map((item) =>
      "descriptor" in item ? item.descriptor : item,
    );
  }

  public ensurePetAsset(petId: string): Promise<WorkbenchPetDescriptor> {
    if (petId.startsWith("custom:")) {
      return Promise.reject(
        new WorkbenchPetProviderError("invalid", "Only built-in pets can be downloaded"),
      );
    }
    const pet = BUILTIN_PETS.find((candidate) => candidate.id === petId);
    if (pet === undefined) {
      return Promise.reject(new WorkbenchPetProviderError("not_found", "Unknown built-in pet"));
    }
    const existing = this.#inFlight.get(petId);
    if (existing !== undefined) return existing;
    const promise = this.#ensureBuiltin(pet).finally(() => this.#inFlight.delete(petId));
    this.#inFlight.set(petId, promise);
    return promise;
  }

  public async openPetAsset(assetId: string): Promise<WorkbenchPetAsset | undefined> {
    let record = this.#assetRecords.get(assetId);
    if (record === undefined) {
      await this.listPets();
      record = this.#assetRecords.get(assetId);
    }
    if (record?.descriptor.availability !== "ready") return undefined;
    try {
      const metadata = await validatePetAsset(record);
      const content = await readFile(record.path);
      return {
        content,
        contentType: record.contentType,
        etag: `W/"${String(metadata.size)}-${String(Math.trunc(metadata.mtimeMs))}"`,
        size: metadata.size,
      };
    } catch {
      throw new WorkbenchPetProviderError("invalid", "Pet asset is invalid");
    }
  }

  async #describeBuiltin(pet: BuiltinPet): Promise<WorkbenchPetDescriptor> {
    const assetId = stableAssetId(`builtin:${PET_PACK_VERSION}:${pet.id}:${pet.file}`);
    const path = this.#builtinPath(pet);
    const baseDirectory = dirname(path);
    let availability: WorkbenchPetDescriptor["availability"] = "downloadable";
    try {
      await validateBuiltinFile(path);
      availability = "ready";
    } catch {
      // 缓存缺失和缓存损坏都保持 downloadable，由显式下载流程修复。
    }
    const descriptor = createBuiltinDescriptor(pet, assetId, availability);
    this.#assetRecords.set(assetId, {
      assetId,
      baseDirectory,
      contentType: "image/webp",
      descriptor,
      path,
    });
    return descriptor;
  }

  async #ensureBuiltin(pet: BuiltinPet): Promise<WorkbenchPetDescriptor> {
    const cached = await this.#describeBuiltin(pet);
    if (cached.availability === "ready") return cached;
    await this.#acquireDownloadSlot();
    const destination = this.#builtinPath(pet);
    const staging = join(dirname(destination), `.${pet.file}.download-${randomUUID()}.webp`);
    try {
      const secondCheck = await this.#describeBuiltin(pet);
      if (secondCheck.availability === "ready") return secondCheck;
      const bytes = await this.#download(pet);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(staging, bytes, { flag: "wx" });
      await validateBuiltinFile(staging);
      try {
        await rename(staging, destination);
      } catch {
        await rm(destination, { force: true });
        await rename(staging, destination);
      }
      return await this.#describeBuiltin(pet);
    } catch (cause) {
      throw new WorkbenchPetProviderError(
        "download_failed",
        cause instanceof Error ? cause.message : "Pet asset download failed",
      );
    } finally {
      await rm(staging, { force: true });
      this.#releaseDownloadSlot();
    }
  }

  async #download(pet: BuiltinPet): Promise<Uint8Array> {
    const url = `${PET_CDN_BASE_URL}/${pet.file}`;
    const response = await this.#fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Pet asset download failed with ${String(response.status)}`);
    if (response.url.length > 0) validateDownloadUrl(response.url);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error("Pet asset download exceeded 4MiB");
    }
    if (response.body === null) throw new Error("Pet asset download returned no body");
    const body: ReadableStream<Uint8Array> = response.body;
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new Error("Pet asset download exceeded 4MiB");
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const dimensions = readWebpDimensions(bytes);
    if (
      dimensions.width !== PET_SPRITESHEET.width ||
      dimensions.height !== PET_SPRITESHEET.height
    ) {
      throw new Error("Pet asset has invalid dimensions");
    }
    return bytes;
  }

  async #scanCustomRoot(
    rootName: "avatars" | "pets",
    manifestName: "avatar.json" | "pet.json",
    source: "custom" | "legacy",
  ): Promise<PetAssetRecord[]> {
    const root = join(this.#codexHome, rootName);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const records: PetAssetRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const directory = join(root, entry.name);
        const assetId = stableAssetId(`${source}:${entry.name}`);
        records.push(
          await loadCustomPet({ assetId, directory, folder: entry.name, manifestName, source }),
        );
      } catch {
        this.#logger?.warn(`Skipped invalid ${source} pet ${entry.name}`);
      }
    }
    return records;
  }

  #builtinPath(pet: BuiltinPet): string {
    return join(this.#codexHome, "cache", "tui-pets", PET_PACK_VERSION, "assets", pet.file);
  }

  async #acquireDownloadSlot(): Promise<void> {
    if (this.#activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
      this.#activeDownloads += 1;
      return;
    }
    await new Promise<void>((resolveWaiter) => this.#downloadWaiters.push(resolveWaiter));
    this.#activeDownloads += 1;
  }

  #releaseDownloadSlot(): void {
    this.#activeDownloads -= 1;
    this.#downloadWaiters.shift()?.();
  }
}

export function createCodexWorkbenchPetProvider(
  options: CreateCodexWorkbenchPetProviderOptions,
): CodexWorkbenchPetProvider {
  return new CodexWorkbenchPetProvider(options);
}

async function validateBuiltinFile(path: string): Promise<void> {
  // macOS 的 /var 等系统路径本身是符号链接，父目录与文件必须统一规范化后再比较。
  const [root, resolved] = await Promise.all([realpath(dirname(path)), realpath(path)]);
  const child = relative(root, resolved);
  if (child === ".." || child.startsWith(`..${sep}`)) throw new Error("Pet cache path escaped");
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size > MAX_DOWNLOAD_BYTES) {
    throw new Error("Pet cache file is invalid");
  }
  const dimensions = await readWebpDimensionsFromFile(resolved);
  if (dimensions.width !== PET_SPRITESHEET.width || dimensions.height !== PET_SPRITESHEET.height) {
    throw new Error("Pet cache file has invalid dimensions");
  }
}

function stableAssetId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateDownloadUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "persistent.oaistatic.com") {
    throw new Error("Pet asset download redirected outside the allowed host");
  }
}
