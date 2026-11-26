import { expect, it } from "vitest";
import { ACP_ENGINE_SETUP_KEY, createAcpEngineSetupStorage } from "./acp-engine-setup.js";
import { ENGINE_SETUP_KEY } from "./engine-setup.js";

it.each([true, false])("旧完成标记 complete=%s 只读导入且写入始终隔离", (complete) => {
  const old = JSON.stringify({ engines: ["claude"], complete });
  const data = new Map([[ENGINE_SETUP_KEY, old]]);
  const storage = createAcpEngineSetupStorage({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  });
  expect(storage.getItem(ENGINE_SETUP_KEY)).toBe(complete ? old : null);
  const next = JSON.stringify({ engines: ["codex"], complete: true });
  storage.setItem(ENGINE_SETUP_KEY, next);
  expect(storage.getItem(ENGINE_SETUP_KEY)).toBe(next);
  expect(data.get(ENGINE_SETUP_KEY)).toBe(old);
  expect(data.get(ACP_ENGINE_SETUP_KEY)).toBe(next);
});
it("私有选择优先且损坏值不被旧标记覆盖", () => {
  const data = new Map([
    [ENGINE_SETUP_KEY, '{"engines":["claude"],"complete":true}'],
    [ACP_ENGINE_SETUP_KEY, "invalid"],
  ]);
  const storage = createAcpEngineSetupStorage({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  });
  expect(storage.getItem(ENGINE_SETUP_KEY)).toBe("invalid");
  expect(() => {
    storage.setItem("unknown", "value");
  }).toThrow("Unexpected");
  expect(data.has("unknown")).toBe(false);
});
