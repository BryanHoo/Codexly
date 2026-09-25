import {
  appPreferenceStorage,
  listNativeCustomBackgrounds,
  updateNativeCustomBackgrounds,
  type NativeCustomBackground,
} from "../../platform/tauri/app-storage.js";
import { buildNativeAssetUrl } from "../../platform/native-asset-url.js";

export type WorkbenchBackgroundMode = "bing" | "custom" | "none";

export type WorkbenchBackgroundPreference = Readonly<{
  blurPercentage: number;
  mode: WorkbenchBackgroundMode;
  overlayOpacity: number;
  selectedCustomImageId: string | null;
  selectedBingDay: string | null;
}>;

export type CustomBackgroundImage = Readonly<{
  assetUrl: string | null;
  blob: Blob | null;
  createdAt: number;
  id: string;
  name: string;
}>;

export type CustomBackgroundMutation = Readonly<{
  deletedImageIds: readonly string[];
  imagesToSave: readonly CustomBackgroundImage[];
}>;

export const DEFAULT_WORKBENCH_BACKGROUND: WorkbenchBackgroundPreference = {
  blurPercentage: 0,
  mode: "none",
  overlayOpacity: 60,
  selectedCustomImageId: null,
  selectedBingDay: null,
};

export const WORKBENCH_BACKGROUND_CHANGED_EVENT = "codeagent:workbench-background-changed";

const BACKGROUND_STORAGE_KEY = "codeagent.workbench-background-preference";
const BACKGROUND_STORAGE_VERSION = 3;
const MAX_CUSTOM_BACKGROUND_BYTES = 20 * 1024 * 1024;
const CUSTOM_BACKGROUND_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

type StorageReader = Readonly<{ getItem: (key: string) => string | null }>;
type StorageWriter = Readonly<{ setItem: (key: string, value: string) => void }>;

function isBackgroundMode(value: unknown): value is WorkbenchBackgroundMode {
  return value === "none" || value === "custom" || value === "bing";
}

export function readWorkbenchBackgroundPreference(
  storage: StorageReader,
): WorkbenchBackgroundPreference {
  try {
    const value: unknown = JSON.parse(storage.getItem(BACKGROUND_STORAGE_KEY) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === BACKGROUND_STORAGE_VERSION &&
      "blurPercentage" in value &&
      typeof value.blurPercentage === "number" &&
      Number.isInteger(value.blurPercentage) &&
      value.blurPercentage >= 0 &&
      value.blurPercentage <= 95 &&
      "mode" in value &&
      isBackgroundMode(value.mode) &&
      "overlayOpacity" in value &&
      typeof value.overlayOpacity === "number" &&
      Number.isInteger(value.overlayOpacity) &&
      value.overlayOpacity >= 0 &&
      value.overlayOpacity <= 95 &&
      "selectedCustomImageId" in value &&
      (value.selectedCustomImageId === null || typeof value.selectedCustomImageId === "string")
    ) {
      return {
        blurPercentage: value.blurPercentage,
        mode: value.mode,
        overlayOpacity: value.overlayOpacity,
        selectedCustomImageId: value.selectedCustomImageId,
        selectedBingDay: "selectedBingDay" in value && typeof value.selectedBingDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.selectedBingDay)
          ? value.selectedBingDay : null,
      };
    }
  } catch {
    // 损坏或不可访问的本地偏好不能阻断工作台启动。
  }
  return DEFAULT_WORKBENCH_BACKGROUND;
}

export function saveWorkbenchBackgroundPreference(
  preference: WorkbenchBackgroundPreference,
  storage: StorageWriter,
): void {
  try {
    storage.setItem(
      BACKGROUND_STORAGE_KEY,
      JSON.stringify({ ...preference, version: BACKGROUND_STORAGE_VERSION }),
    );
  } catch {
    // 存储被禁用时仍应用当前页面偏好。
  }
}

export function isSupportedCustomBackgroundImage(
  image: Readonly<{ size: number; type: string }>,
): boolean {
  return (
    image.size > 0 &&
    image.size <= MAX_CUSTOM_BACKGROUND_BYTES &&
    CUSTOM_BACKGROUND_TYPES.has(image.type)
  );
}

export function createCustomBackgroundImage(
  file: File,
  id = crypto.randomUUID(),
): CustomBackgroundImage {
  return { assetUrl: null, blob: file, createdAt: Date.now(), id, name: file.name };
}

export function removeCustomBackgroundFromDraft(
  images: readonly CustomBackgroundImage[],
  removedImageId: string,
  selectedCustomImageId: string | null,
): Readonly<{
  images: readonly CustomBackgroundImage[];
  selectedCustomImageId: string | null;
}> {
  const remainingImages = images.filter((image) => image.id !== removedImageId);
  return {
    images: remainingImages,
    selectedCustomImageId:
      selectedCustomImageId === removedImageId
        ? (remainingImages[0]?.id ?? null)
        : selectedCustomImageId,
  };
}

export async function readCustomBackgroundImages(): Promise<readonly CustomBackgroundImage[]> {
  const metadata = await listNativeCustomBackgrounds();
  return metadata.map((image) => ({
    assetUrl: buildNativeAssetUrl(image.assetPath),
    blob: null,
    createdAt: image.createdAt,
    id: image.id,
    name: image.name,
  }));
}

export async function readCustomBackgroundImageSource(id: string): Promise<string | null> {
  const image = (await listNativeCustomBackgrounds()).find((candidate) => candidate.id === id);
  return image === undefined ? null : buildNativeAssetUrl(image.assetPath);
}

export async function applyCustomBackgroundMutation(mutation: CustomBackgroundMutation): Promise<void> {
  if (mutation.deletedImageIds.length === 0 && mutation.imagesToSave.length === 0) return;
  const images: NativeCustomBackground[] = await Promise.all(
    mutation.imagesToSave.map(async (image) => {
      if (image.blob === null) throw new Error("Custom background content is unavailable");
      return {
        bytes: Array.from(new Uint8Array(await image.blob.arrayBuffer())),
        createdAt: image.createdAt,
        id: image.id,
        mediaType: image.blob.type,
        name: image.name,
      };
    }),
  );
  await updateNativeCustomBackgrounds(mutation.deletedImageIds, images);
}

export function publishWorkbenchBackgroundPreference(preference: WorkbenchBackgroundPreference): void {
  saveWorkbenchBackgroundPreference(preference, appPreferenceStorage);
  window.dispatchEvent(
    new CustomEvent<WorkbenchBackgroundPreference>(WORKBENCH_BACKGROUND_CHANGED_EVENT, {
      detail: preference,
    }),
  );
}
