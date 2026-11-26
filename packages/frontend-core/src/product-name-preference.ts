export const DEFAULT_PRODUCT_NAME = "Codexly";

type ProductNameStorage = Pick<Storage, "getItem" | "setItem">;

function normalizeProductName(value: string): string {
  return value.trim() || DEFAULT_PRODUCT_NAME;
}

export function createProductNamePreference(storage: ProductNameStorage, key: string) {
  let name: string | undefined;
  const listeners = new Set<() => void>();

  function getSnapshot(): string {
    // 首次读取发生在平台偏好初始化后，后续渲染直接使用内存快照。
    if (name === undefined) {
      try {
        name = normalizeProductName(storage.getItem(key) ?? "");
      } catch {
        name = DEFAULT_PRODUCT_NAME;
      }
    }
    return name;
  }

  return {
    getSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(value: string) {
      const next = normalizeProductName(value);
      if (next === getSnapshot()) return next;
      name = next;
      try {
        storage.setItem(key, next);
      } catch {
        // 浏览器存储不可用时，当前页面仍同步更新名称。
      }
      listeners.forEach((listener) => {
        listener();
      });
      return next;
    },
  };
}

export type ProductNamePreference = ReturnType<typeof createProductNamePreference>;
