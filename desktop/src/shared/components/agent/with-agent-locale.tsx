import { useCallback, type ComponentType } from "react";
import { AgentLocaleProvider } from "@codexly/ui/agent/locale";
import { useTranslation } from "../../../i18n/i18n.js";
export function withAgentLocale<P extends object>(Component: ComponentType<P>) {
  return function LocalizedAgentComponent(props: P) {
    const { t } = useTranslation("conversation");
    const translate = useCallback((key: string, values?: Record<string, unknown>) => t(key, values ?? {}), [t]);
    return <AgentLocaleProvider translate={translate}><Component {...props} /></AgentLocaleProvider>;
  };
}
