export type WorkbenchBackgroundMode = "bing" | "custom" | "none";

export type WorkbenchBackgroundPreference = Readonly<{
  blurPercentage: number;
  customImageName: string | null;
  mode: WorkbenchBackgroundMode;
  overlayOpacity: number;
}>;

export const DEFAULT_WORKBENCH_BACKGROUND: WorkbenchBackgroundPreference = {
  blurPercentage: 0,
  customImageName: null,
  mode: "none",
  overlayOpacity: 60,
};

export const WORKBENCH_BACKGROUND_CHANGED_EVENT = "codexly:workbench-background-changed";

const BACKGROUND_STORAGE_KEY = "codexly.workbench-background-preference";
const BACKGROUND_STORAGE_VERSION = 2;
const BACKGROUND_DATABASE_NAME = "codexly-workbench";
const BACKGROUND_DATABASE_VERSION = 1;
const BACKGROUND_OBJECT_STORE = "background-images";
const CUSTOM_BACKGROUND_KEY = "custom";
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
      "customImageName" in value &&
      (value.customImageName === null || typeof value.customImageName === "string")
    ) {
      return {
        blurPercentage: value.blurPercentage,
        customImageName: value.customImageName,
        mode: value.mode,
        overlayOpacity: value.overlayOpacity,
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

function openBackgroundDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(BACKGROUND_DATABASE_NAME, BACKGROUND_DATABASE_VERSION);
    request.onerror = () => {
      reject(request.error ?? new Error("Unable to open background image storage"));
    };
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BACKGROUND_OBJECT_STORE)) {
        database.createObjectStore(BACKGROUND_OBJECT_STORE);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

export async function readCustomBackgroundImage(): Promise<Blob | null> {
  const database = await openBackgroundDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BACKGROUND_OBJECT_STORE, "readonly");
    const request = transaction.objectStore(BACKGROUND_OBJECT_STORE).get(CUSTOM_BACKGROUND_KEY);
    request.onerror = () => {
      reject(request.error ?? new Error("Unable to read custom background image"));
    };
    request.onsuccess = () => {
      resolve(request.result instanceof Blob ? request.result : null);
    };
    transaction.oncomplete = () => {
      database.close();
    };
  });
}

async function saveCustomBackgroundImage(image: Blob): Promise<void> {
  const database = await openBackgroundDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BACKGROUND_OBJECT_STORE, "readwrite");
    transaction.objectStore(BACKGROUND_OBJECT_STORE).put(image, CUSTOM_BACKGROUND_KEY);
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Unable to save custom background image"));
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
  });
}

export async function applyWorkbenchBackgroundPreference(
  preference: WorkbenchBackgroundPreference,
  customImage: File | null,
): Promise<void> {
  if (customImage !== null) {
    if (!isSupportedCustomBackgroundImage(customImage)) {
      throw new Error("Unsupported custom background image");
    }
    // 先提交图片正文再发布偏好，避免工作台读到指向尚未落盘图片的元数据。
    await saveCustomBackgroundImage(customImage);
  }
  saveWorkbenchBackgroundPreference(preference, window.localStorage);
  window.dispatchEvent(
    new CustomEvent<WorkbenchBackgroundPreference>(WORKBENCH_BACKGROUND_CHANGED_EVENT, {
      detail: preference,
    }),
  );
}
