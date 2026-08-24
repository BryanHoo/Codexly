const NOTIFICATION_STORAGE_KEY = "codexly.notification-preference";
const NOTIFICATION_STORAGE_VERSION = 1;

type NotificationStorageReader = Readonly<{ getItem: (key: string) => string | null }>;
type NotificationStorageWriter = Readonly<{ setItem: (key: string, value: string) => void }>;

export function readNotificationPreference(storage: NotificationStorageReader): boolean {
  try {
    const value: unknown = JSON.parse(storage.getItem(NOTIFICATION_STORAGE_KEY) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === NOTIFICATION_STORAGE_VERSION &&
      "enabled" in value &&
      typeof value.enabled === "boolean"
    ) {
      return value.enabled;
    }
  } catch {
    // 本地偏好损坏或存储不可访问时保留现有默认行为。
  }
  return true;
}

export function saveNotificationPreference(
  enabled: boolean,
  storage: NotificationStorageWriter,
): void {
  try {
    storage.setItem(
      NOTIFICATION_STORAGE_KEY,
      JSON.stringify({ enabled, version: NOTIFICATION_STORAGE_VERSION }),
    );
  } catch {
    // 浏览器禁用存储时仅影响后续页面加载，不阻断设置保存。
  }
}

export function getNotificationPreference(): boolean {
  try {
    return typeof window === "undefined" ? true : readNotificationPreference(window.localStorage);
  } catch {
    return true;
  }
}

export function setNotificationPreference(enabled: boolean): void {
  try {
    if (typeof window !== "undefined") {
      saveNotificationPreference(enabled, window.localStorage);
    }
  } catch {
    // 访问 localStorage 本身被浏览器拒绝时保持当前运行不受影响。
  }
}
