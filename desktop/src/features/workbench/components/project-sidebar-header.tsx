import { PanelLeftClose, Search } from "lucide-react";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";

export function ProjectSidebarHeader({
  onClose,
  onSearch,
}: Readonly<{ onClose: () => void; onSearch: () => void }>) {
  const { t } = useTranslation("workbench");
  return (
    <div className="flex h-workbench-header items-center gap-1.5 px-3">
      <ProductBrand />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={t("sidebar.search")}
            aria-keyshortcuts="Meta+F Control+F"
            id="project-sidebar-search-trigger"
            onClick={onSearch}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Search className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("sidebar.search")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={t("sidebar.close")}
            className="min-workbench:hidden"
            onClick={onClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <PanelLeftClose className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("sidebar.close")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function ProductBrand() {
  return (
    <div className="flex min-w-0 flex-1 items-center">
      <img
        alt="Codexly"
        className="h-7 w-auto max-w-full"
        height="28"
        src="/brand/codexly-logo.svg"
        width="116"
      />
    </div>
  );
}
