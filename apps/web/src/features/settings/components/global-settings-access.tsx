import { LogOut } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { SettingsField, SettingsPanel, type SettingsSectionId } from "./global-settings-fields.js";

export function GlobalSettingsAccess({
  activeSection,
  onLogout,
}: Readonly<{
  activeSection: SettingsSectionId;
  onLogout?: () => Promise<void>;
}>) {
  const { t } = useTranslation("settings");
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  return (
    <SettingsPanel activeSection={activeSection} id="access" title={t("sections.access")}>
      <SettingsField label={t("access.currentSession")}>
        <div className="flex min-w-0 flex-col items-start gap-2 py-1">
          <p className="text-body-small text-muted-foreground">{t("access.sessionDescription")}</p>
          <Button
            className="inline-flex h-8 items-center gap-2 rounded-control bg-control px-3 text-body-small font-medium text-danger hover:bg-control-hover focus-visible:shadow-focus disabled:opacity-50"
            disabled={isLoggingOut || onLogout === undefined}
            onClick={() => {
              if (onLogout === undefined) return;
              setIsLoggingOut(true);
              void onLogout()
                .catch(() => undefined)
                .finally(() => {
                  setIsLoggingOut(false);
                });
            }}
            type="button"
            variant="ghost"
          >
            <LogOut aria-hidden="true" data-icon="inline-start" />
            {isLoggingOut ? t("access.loggingOut") : t("access.logout")}
          </Button>
        </div>
      </SettingsField>
    </SettingsPanel>
  );
}
