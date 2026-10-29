import { describe, expect, it, vi } from "vitest";
import { createConversationDisplayPreferenceStore } from "./conversation-display-preferences.js";

const key = "test:conversation-display:v1";
function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
  };
}

describe("消息显示偏好", () => {
  it.each([null, "invalid", '{"stickyPrompt":"true","navigation":1}'])(
    "未配置或损坏的设置默认全部关闭：%s",
    (initial) => {
      const store = createConversationDisplayPreferenceStore(memoryStorage(initial), key);
      expect(store.getSnapshot()).toEqual({ stickyPrompt: false, navigation: false });
    },
  );

  it("独立切换两个选项，通知订阅者，并在重新创建后恢复", () => {
    const storage = memoryStorage();
    const store = createConversationDisplayPreferenceStore(storage, key);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set("stickyPrompt", true);
    expect(store.getSnapshot()).toEqual({ stickyPrompt: true, navigation: false });
    store.set("navigation", true);
    store.set("stickyPrompt", false);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(createConversationDisplayPreferenceStore(storage, key).getSnapshot()).toEqual({
      stickyPrompt: false,
      navigation: true,
    });
    store.set("navigation", true);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    store.set("navigation", false);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("存储不可访问时仍能在当前会话中切换", () => {
    const store = createConversationDisplayPreferenceStore(
      {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("quota");
        },
      },
      key,
    );
    expect(store.getSnapshot()).toEqual({ stickyPrompt: false, navigation: false });
    store.set("stickyPrompt", true);
    expect(store.getSnapshot().stickyPrompt).toBe(true);
  });
});
