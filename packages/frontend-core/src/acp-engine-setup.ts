import { ENGINE_SETUP_KEY, readEngineSetup } from "./engine-setup.js";

export const ACP_ENGINE_SETUP_KEY = "codexly:acp-engine-setup:v1";
interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 复用向导和启用事务，但将所有写入限定在 ACP 私有键；旧完成状态仅作只读导入。 */
export function createAcpEngineSetupStorage(storage: StoragePort): StoragePort {
  return {
    getItem(key) {
      if (key !== ENGINE_SETUP_KEY) return storage.getItem(key);
      const current = storage.getItem(ACP_ENGINE_SETUP_KEY);
      if (current !== null) return current;
      const old = storage.getItem(ENGINE_SETUP_KEY);
      return readEngineSetup(old)?.complete ? old : null;
    },
    setItem(key, value) {
      if (key !== ENGINE_SETUP_KEY) throw new Error("Unexpected ACP setup storage key");
      storage.setItem(ACP_ENGINE_SETUP_KEY, value);
    },
  };
}
