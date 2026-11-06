import { SettingsGroup, SettingsField, SettingsSelect } from "./global-settings-fields.js";
import {
  NetworkProxySettingsPanel,
  NETWORK_PROXY_LABELS,
} from "@codexly/ui/core/network-proxy-settings";
import type { NetworkProxySettings, NetworkProxyStatus } from "@codexly/protocol";
import { useTranslation } from "../../../i18n/i18n.js";
import { invoke } from "../../../platform/tauri/native-invoke.js";
const components = { Group: SettingsGroup, Field: SettingsField, Select: SettingsSelect };
const read = () => invoke<NetworkProxyStatus>("read_network_proxy");
const save = (settings: NetworkProxySettings) =>
  invoke<NetworkProxyStatus>("save_network_proxy", { settings });
const test = (settings: NetworkProxySettings) => invoke("test_network_proxy", { settings });
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
