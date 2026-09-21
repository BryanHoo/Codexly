import { Download } from "lucide-react";
import type { ReactElement } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../../shared/components/core/context-menu.js";

type LanDownloadContextMenuProps = Readonly<{
  children: ReactElement;
  enabled: boolean;
  name: string;
  open?: boolean;
  url: string;
}>;

export function LanDownloadContextMenu({
  children,
  enabled,
  name,
  open,
  url,
}: LanDownloadContextMenuProps) {
  const { t } = useTranslation("workbench");
  if (!enabled) return children;

  return (
    <ContextMenu {...(open === undefined ? {} : { open })} modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={t("openMenu.targetLabel", { path: name })}>
        <ContextMenuItem asChild>
          <a download={name} href={url}>
            <Download aria-hidden="true" className="size-4 text-muted-foreground" />
            <span>{t("openMenu.download")}</span>
          </a>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
