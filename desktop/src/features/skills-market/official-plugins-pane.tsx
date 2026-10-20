import {lazy, Suspense} from "react";
import {CodexOfficialPluginsPane} from "@codexly/ui/core/codex-official-plugins-pane";
import {useTranslation} from "../../i18n/i18n.js";
import {useProjectData} from "../projects/project-context.js";
import "../../shared/styles/official-plugins.css";

const OfficialPluginSheet = lazy(() => import("./official-plugin-sheet.js").then(module => ({default: module.OfficialPluginSheet})));

export function OfficialPluginsPane() {
  const {client} = useProjectData();
  const {t} = useTranslation("workbench");
  return <CodexOfficialPluginsPane client={client} t={(key, options) => t(key, options ?? {})}
    installPlugin={plugin => client.installOfficialPlugin(plugin.marketplaceName, plugin.marketplacePath, plugin.pluginName, globalThis.crypto.randomUUID())}
    uninstallPlugin={plugin => client.uninstallOfficialPlugin(plugin.id)}
    renderDetails={props => <Suspense fallback={null}><OfficialPluginSheet {...props} client={client} /></Suspense>}
  />;
}
