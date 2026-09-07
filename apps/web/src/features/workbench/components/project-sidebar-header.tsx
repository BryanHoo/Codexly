import { PanelLeftClose, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Input } from "../../../shared/components/core/input.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";

type ProjectSidebarHeaderProps = Readonly<{
  onClose: () => void;
  query: string;
  setQuery: (query: string) => void;
}>;

export function ProjectSidebarHeader({ onClose, query, setQuery }: ProjectSidebarHeaderProps) {
  const { t } = useTranslation("workbench");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isSearchOpen) {
      inputRef.current?.focus();
    }
  }, [isSearchOpen]);

  const closeSearch = () => {
    // 收起时同步取消筛选，并把焦点交还触发按钮，保证键盘操作连续。
    setQuery("");
    setIsSearchOpen(false);
    requestAnimationFrame(() => {
      searchButtonRef.current?.focus();
    });
  };

  return (
    <div className="flex h-workbench-header items-center gap-1.5 px-3">
      {isSearchOpen ? (
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground"
          />
          <Input
            aria-label={t("sidebar.search")}
            className="h-8 w-full rounded-control bg-control pl-8 pr-2 text-body-small text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:shadow-focus"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeSearch();
              }
            }}
            placeholder={t("sidebar.search")}
            ref={inputRef}
            value={query}
          />
        </div>
      ) : (
        <ProductBrand />
      )}

      {isSearchOpen ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t("sidebar.closeSearch")}
              onClick={closeSearch}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("sidebar.closeSearch")}</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t("sidebar.search")}
              onClick={() => {
                setIsSearchOpen(true);
              }}
              ref={searchButtonRef}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Search className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("sidebar.search")}</TooltipContent>
        </Tooltip>
      )}

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
