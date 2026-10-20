import { createContext, useContext } from "react";

/** 范围由共享扩展中心提供，两端的 Codex 面板读取同一个选择结果。 */
export const ExtensionProjectScope = createContext<string | undefined>(undefined);
export function useExtensionProject() {
  return useContext(ExtensionProjectScope);
}
