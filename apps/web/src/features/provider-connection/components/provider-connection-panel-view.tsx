import {
  ProviderConnectionPanelView as SharedProviderConnectionPanelView,
  type ProviderConnectionPanelViewProps,
} from "@codexly/ui/core/provider-connection-panel";
import "../../../i18n/settings-provider.js";
import { useTranslation } from "../../../i18n/i18n.js";
export {
  hasIncompleteCustomModels,
  type ConnectionMode,
} from "@codexly/ui/core/provider-connection-panel";

/** 平台层仅提供翻译，设置与初始化的交互和布局由共享视图统一维护。 */
export function ProviderConnectionPanelView(
  props: Omit<ProviderConnectionPanelViewProps, "labels" | "modelLabels">,
) {
  const { t } = useTranslation("settings");
  return (
    <SharedProviderConnectionPanelView
      {...props}
      labels={{
        account: t("provider.account"),
        apiKey: t("provider.apiKey"),
        baseUrl: t("provider.baseUrl"),
        cancelLogin: t("provider.cancelLogin"),
        connect: t("provider.connect"),
        connected: t("provider.connected"),
        connecting: t("provider.connecting"),
        credentials: t("provider.credentials"),
        custom: t("provider.custom"),
        disconnected: t("provider.disconnected"),
        hideKey: t("provider.hideKey"),
        login: t("provider.login"),
        loginHint: t("provider.loginHint"),
        logout: t("provider.logout"),
        mode: t("provider.mode"),
        official: t("provider.official"),
        reconnect: t("provider.reconnect"),
        retry: t("provider.retry"),
        showKey: t("provider.showKey"),
        waiting: t("provider.waiting"),
      }}
      modelLabels={{
        addModel: t("provider.addModel"),
        automaticModels: t("provider.automaticModels"),
        modelId: t("provider.modelId"),
        modelName: t("provider.modelName"),
        models: t("provider.models"),
        removeModel: t("provider.removeModel"),
      }}
    />
  );
}
