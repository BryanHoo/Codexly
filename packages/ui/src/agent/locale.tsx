import { createContext, useContext, type ReactNode } from "react";
export type AgentTranslate = (key: string, values?: Record<string, unknown>) => string;
const AgentLocaleContext = createContext<AgentTranslate>((key) => key);
/** 翻译由平台注入，共享 UI 不依赖任一应用的 i18n 单例。 */
export function AgentLocaleProvider({
  translate,
  children,
}: {
  translate: AgentTranslate;
  children: ReactNode;
}) {
  return <AgentLocaleContext.Provider value={translate}>{children}</AgentLocaleContext.Provider>;
}
export function useAgentTranslation() {
  return { t: useContext(AgentLocaleContext) };
}
