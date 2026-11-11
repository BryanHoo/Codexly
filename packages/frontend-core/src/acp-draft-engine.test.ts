import { expect, it, vi } from "vitest";
import { readAcpDraftEngine, saveAcpDraftEngine } from "./acp-draft-engine.js";

it("导入旧引擎选择但不改写旧偏好，新选择只保存到 ACP 私有键", () => {
  const values = new Map([["codexly:engine-draft:v1:scope", "claude"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  expect(readAcpDraftEngine(storage, "scope", ["codex", "claude"])).toBe("claude");
  saveAcpDraftEngine(storage, "scope", "codex");
  expect(values.get("codexly:engine-draft:v1:scope")).toBe("claude");
  expect(readAcpDraftEngine(storage, "scope", ["codex", "claude"])).toBe("codex");
  expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(
    "codexly:acp-engine-draft:v1:scope",
    "codex",
  );
});
it("单引擎跳过记忆读取，损坏或已禁用的选择回退到已启用引擎", () => {
  const storage = { getItem: vi.fn(() => "unknown"), setItem: vi.fn() };
  expect(readAcpDraftEngine(storage, "scope", ["claude"])).toBe("claude");
  expect(storage.getItem).not.toHaveBeenCalled();
  expect(readAcpDraftEngine(storage, "scope", ["claude", "codex"])).toBe("claude");
});
