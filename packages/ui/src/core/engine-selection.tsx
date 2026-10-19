import { createContext, useContext } from "react";
import type { EngineActivation } from "@codexly/frontend-core/engine-activation";
import type { AgentEngine } from "@codexly/protocol";
export const SelectedEnginesContext = createContext<readonly AgentEngine[] | undefined>(undefined);
export const useSelectedEngines = () => useContext(SelectedEnginesContext);
export type SetupStorage = Pick<Storage, "getItem" | "setItem">;
export const browserSetupStorage: SetupStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 禁用持久化时本次启动仍可继续。 */
    }
  },
};

export const EngineActivationContext = createContext<EngineActivation | undefined>(undefined);
