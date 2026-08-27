export type WorkbenchBackgroundMode = "bing" | "custom" | "none";

export type WorkbenchBackgroundPreference = Readonly<{
  blurPercentage: number;
  mode: WorkbenchBackgroundMode;
  overlayOpacity: number;
  selectedCustomImageId: string | null;
}>;

export type CustomBackgroundImage = Readonly<{
  blob: Blob;
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
};

export const WORKBENCH_BACKGROUND_CHANGED_EVENT = "codexly:workbench-background-changed";

const BACKGROUND_STORAGE_KEY = "codexly.workbench-background-preference";
const BACKGROUND_STORAGE_VERSION = 3;
const BACKGROUND_DATABASE_NAME = "codexly-workbench";
const BACKGROUND_DATABASE_VERSION = 2;
const BACKGROUND_OBJECT_STORE = "background-images";
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
  return { blob: file, createdAt: Date.now(), id, name: file.name };
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

function openBackgroundDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(BACKGROUND_DATABASE_NAME, BACKGROUND_DATABASE_VERSION);
    request.onerror = () => {
      reject(request.error ?? new Error("Unable to open background image storage"));
    };
    request.onupgradeneeded = () => {
      const database = request.result;
      // v2 起每张图片使用独立记录；旧固定键仓库无法表达图片集合，直接重建。
      if (database.objectStoreNames.contains(BACKGROUND_OBJECT_STORE)) {
        database.deleteObjectStore(BACKGROUND_OBJECT_STORE);
      }
      database.createObjectStore(BACKGROUND_OBJECT_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function isCustomBackgroundImage(value: unknown): value is CustomBackgroundImage {
  return (
    typeof value === "object" &&
    value !== null &&
    "blob" in value &&
    value.blob instanceof Blob &&
    "createdAt" in value &&
    typeof value.createdAt === "number" &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string"
  );
}

export async function readCustomBackgroundImages(): Promise<readonly CustomBackgroundImage[]> {
  const database = await openBackgroundDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BACKGROUND_OBJECT_STORE, "readonly");
    const request = transaction.objectStore(BACKGROUND_OBJECT_STORE).getAll();
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Unable to read custom background images"));
    };
    request.onsuccess = () => {
      resolve(
        request.result
          .filter(isCustomBackgroundImage)
          .sort((first, second) => first.createdAt - second.createdAt),
      );
    };
    transaction.oncomplete = () => {
      database.close();
    };
  });
}

export async function readCustomBackgroundImage(id: string): Promise<Blob | null> {
  const database = await openBackgroundDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BACKGROUND_OBJECT_STORE, "readonly");
    const request = transaction.objectStore(BACKGROUND_OBJECT_STORE).get(id);
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Unable to read custom background image"));
    };
    request.onsuccess = () => {
      resolve(isCustomBackgroundImage(request.result) ? request.result.blob : null);
    };
    transaction.oncomplete = () => {
      database.close();
    };
  });
}

async function applyCustomBackgroundMutation(mutation: CustomBackgroundMutation): Promise<void> {
  if (mutation.deletedImageIds.length === 0 && mutation.imagesToSave.length === 0) return;
  const database = await openBackgroundDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BACKGROUND_OBJECT_STORE, "readwrite");
    const store = transaction.objectStore(BACKGROUND_OBJECT_STORE);
    mutation.deletedImageIds.forEach((id) => store.delete(id));
    mutation.imagesToSave.forEach((image) => store.put(image));
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Unable to update custom background images"));
    };
    transaction.onabort = () => {
      database.close();
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
  });
}

export async function applyWorkbenchBackgroundPreference(
  preference: WorkbenchBackgroundPreference,
  mutation: CustomBackgroundMutation,
): Promise<void> {
  // 先提交图片集合再发布偏好，避免工作台读取到尚未落盘的图片 ID。
  await applyCustomBackgroundMutation(mutation);
  saveWorkbenchBackgroundPreference(preference, window.localStorage);
  window.dispatchEvent(
    new CustomEvent<WorkbenchBackgroundPreference>(WORKBENCH_BACKGROUND_CHANGED_EVENT, {
      detail: preference,
    }),
  );
}
