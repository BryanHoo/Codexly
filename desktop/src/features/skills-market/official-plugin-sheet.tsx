import type { OfficialPluginInstallResult, OfficialPluginSummary } from "@/protocol/index.js";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  ExternalLink,
  Info,
  LoaderCircle,
  PackageCheck,
  PlugZap,
  Workflow,
} from "lucide-react";

import { useTranslation } from "../../i18n/i18n.js";
import { openExternalUrl } from "../../platform/tauri/external-url.js";
import { Button } from "../../shared/components/core/button.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../../shared/components/core/sheet.js";
import type { NativeSkillsClient } from "../projects/project-query-contracts.js";

export function OfficialPluginSheet({
  client,
  installResult,
  installing,
  onInstall,
  onOpenChange,
  onUninstall,
  plugin,
  uninstalling,
}: Readonly<{
  client: NativeSkillsClient;
  installResult: OfficialPluginInstallResult | null;
  installing: boolean;
  onInstall: () => void;
  onOpenChange: (open: boolean) => void;
  onUninstall: () => void;
  plugin: OfficialPluginSummary;
  uninstalling: boolean;
}>) {
  const { t } = useTranslation("workbench");
  const detail = useQuery({
    queryFn: () => client.getOfficialPlugin(
      plugin.marketplaceName,
      plugin.marketplacePath,
      plugin.pluginName,
    ),
    queryKey: [
      "extensions",
      "plugins",
      "detail",
      plugin.marketplaceName,
      plugin.marketplacePath,
      plugin.pluginName,
    ],
    staleTime: 5 * 60_000,
  });
  const data = detail.data;
  const apps = installResult?.appsNeedingAuth ?? data?.apps ?? [];

  return (
    <Sheet onOpenChange={onOpenChange} open>
      <SheetContent className="official-plugin-sheet" closeLabel={t("skillsMarket.closeDetails")}>
        <SheetHeader className="official-plugin-sheet__header">
          <div className="skills-market-glyph" data-tone="plugins" aria-hidden="true">
            <PackageCheck />
          </div>
          <div className="min-w-0">
            <SheetTitle>{plugin.displayName}</SheetTitle>
            <SheetDescription>
              {plugin.developerName ?? t("skillsMarket.officialPublisher")}
            </SheetDescription>
          </div>
        </SheetHeader>
        <div className="official-plugin-sheet__body">
          {detail.isPending ? (
            <div className="skills-market-state" role="status">
              {t("skillsMarket.loadingDetail")}
            </div>
          ) : detail.error !== null ? (
            <div className="skills-market-state" role="alert">
              {t("skillsMarket.pluginError")}
            </div>
          ) : (
            <>
              <p className="text-body-small leading-6 text-muted-foreground">
                {data?.description || plugin.description}
              </p>
              {installResult === null ? null : (
                <p className="official-plugin-session-note" role="status">
                  <Info aria-hidden="true" />
                  {t("skillsMarket.newSessionRequired")}
                </p>
              )}
              <div className="official-plugin-assets">
                <section>
                  <h4>
                    <Boxes aria-hidden="true" />Skills <span>{data?.skills.length ?? 0}</span>
                  </h4>
                  {data?.skills.map((skill) => (
                    <div className="official-plugin-asset" key={skill.name}>
                      <strong>{skill.name}</strong>
                      <p>{skill.description}</p>
                    </div>
                  ))}
                </section>
                <section>
                  <h4>
                    <PlugZap aria-hidden="true" />MCP <span>{data?.mcpServers.length ?? 0}</span>
                  </h4>
                  {data?.mcpServers.map((server) => (
                    <div className="official-plugin-asset" key={server}>
                      <strong>{server}</strong>
                    </div>
                  ))}
                </section>
                <section>
                  <h4>
                    <Workflow aria-hidden="true" />Apps <span>{apps.length}</span>
                  </h4>
                  {apps.map((app) => {
                    const installUrl = app.installUrl;
                    return (
                      <div className="official-plugin-asset" key={app.id}>
                        <strong>{app.name}</strong>
                        <p>{app.description}</p>
                        {installUrl === null ? null : (
                          <Button
                            onClick={() => void openExternalUrl(installUrl)}
                            size="compact"
                            type="button"
                            variant="outline"
                          >
                            <ExternalLink aria-hidden="true" />
                            {t("skillsMarket.authorize")}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </section>
              </div>
            </>
          )}
        </div>
        <SheetFooter className="official-plugin-sheet__footer">
          {plugin.installed ? (
            <Button
              disabled={uninstalling}
              onClick={onUninstall}
              type="button"
              variant="destructive"
            >
              {t("skillsMarket.uninstallPlugin")}
            </Button>
          ) : (
            <Button
              disabled={
                installing ||
                plugin.installPolicy === "NOT_AVAILABLE" ||
                plugin.availability !== "AVAILABLE"
              }
              onClick={onInstall}
              type="button"
            >
              {installing ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" data-icon="loading" />
              ) : null}
              {t("skillsMarket.installPlugin")}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
