import { SettingsGroup, SettingsField, SettingsSelect } from "./global-settings-fields.js";
import {
  NetworkProxySettingsPanel,
  NETWORK_PROXY_LABELS,
} from "@codexly/ui/core/network-proxy-settings";
import type { NetworkProxySettings } from "@codexly/protocol";
import { useTranslation } from "../../../i18n/i18n.js";
import { codexlyClient } from "../../projects/project-query-contracts.js";
const components = { Group: SettingsGroup, Field: SettingsField, Select: SettingsSelect };
const read = () => codexlyClient.readNetworkProxy();
const save = (settings: NetworkProxySettings) => codexlyClient.saveNetworkProxy(settings);
const test = (settings: NetworkProxySettings) => codexlyClient.testNetworkProxy(settings);
export function NetworkProxySettingsField() {
  const { i18n } = useTranslation("settings");
  return (
    <NetworkProxySettingsPanel
      components={components}
      read={read}
      save={save}
      test={test}
      labels={NETWORK_PROXY_LABELS[i18n.language.startsWith("zh") ? "zh-CN" : "en"]}
    />
  );
}
