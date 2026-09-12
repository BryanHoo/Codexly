type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const unavailableStorage: PreferenceStorage = {
  getItem: () => null,
  setItem: () => undefined,
};

export function getSafeLocalStorage(): PreferenceStorage {
  try {
    // 属性 getter 本身也可能抛出 SecurityError，必须在保护范围内获取。
    return typeof window === "undefined" ? unavailableStorage : window.localStorage;
  } catch {
    // 无法持久化时按缺省偏好读取，交互状态仍由各功能在当前页面维护。
    return unavailableStorage;
  }
}
