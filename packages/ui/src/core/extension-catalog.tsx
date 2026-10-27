import type { ComponentPropsWithRef, ReactNode } from "react";
import { Switch } from "radix-ui";
import {
  BadgeCheck,
  Blocks,
  Download,
  LoaderCircle,
  RefreshCw,
  Search,
  Server,
} from "lucide-react";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "./dialog.js";
import type { ExtensionTranslate } from "./extension-center-types.js";

const icons = { skills: Blocks, mcp: Server, plugins: BadgeCheck };

/** 两种引擎的三个栏目共用搜索、目录操作与筛选，避免平台或引擎各自维护视觉样式。 */
export function ExtensionCatalogToolbar({
  search,
  onSearch,
  count,
  loading,
  onRefresh,
  filter,
  onFilter,
  onSync,
  syncing,
  t,
}: Readonly<{
  search: string;
  onSearch: (value: string) => void;
  count: number;
  loading: boolean;
  onRefresh: () => void;
  filter?: string;
  onFilter?: (value: string) => void;
  onSync?: () => void;
  syncing?: boolean;
  t: ExtensionTranslate;
}>) {
  return (
    <>
      <div className="skills-market-toolbar">
        <label className="extension-search">
          <Search aria-hidden="true" />
          <Input
            variant="embedded"
            aria-label={t("skillsMarket.center.search")}
            placeholder={t("skillsMarket.center.search")}
            value={search}
            onChange={(event) => {
              onSearch(event.target.value);
            }}
          />
        </label>
        <div className="extension-center__actions">
          {onSync ? (
            <Button
              variant="outline"
              disabled={loading || syncing}
              aria-busy={syncing ?? false}
              onClick={onSync}
            >
              {syncing ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              {t("skillsMarket.center.syncCatalog")}
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("skillsMarket.center.refresh")}
                size="icon"
                variant="ghost"
                disabled={loading}
                onClick={onRefresh}
              >
                <RefreshCw aria-hidden="true" className={loading ? "animate-spin" : ""} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("skillsMarket.center.refresh")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="extension-center__list-meta">
        <span>{t("skillsMarket.center.count", { count })}</span>
        {filter !== undefined && onFilter ? (
          <Select value={filter} onValueChange={onFilter}>
            <SelectTrigger size="sm" aria-label={t("skillsMarket.center.filter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectItem value="all">{t("skillsMarket.center.all")}</SelectItem>
              <SelectItem value="installed">{t("skillsMarket.installedPlugins")}</SelectItem>
              <SelectItem value="available">{t("skillsMarket.availablePlugins")}</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </>
  );
}

type ItemProps = ComponentPropsWithRef<"li"> &
  Readonly<{
    name: string;
    description: string;
    hint?: string | undefined;
    scopeLabel: string;
    version?: string | undefined;
    kind: "skills" | "mcp" | "plugins";
    actions: ReactNode;
    onOpen?: (() => void) | undefined;
    openLabel?: string | undefined;
  }>;

/** ref、测量索引和定位样式继续透传到 li，供大目录的可变高度虚拟列表复用。 */
export function ExtensionItem({
  name,
  description,
  hint,
  scopeLabel,
  version,
  kind,
  actions,
  onOpen,
  openLabel,
  ...props
}: ItemProps) {
  const Icon = icons[kind];
  return (
    <li {...props} className="extension-item">
      <span className="skills-market-glyph" data-tone={kind}>
        <Icon aria-hidden="true" />
      </span>
      <div className="extension-item__body">
        <div className="extension-item__title">
          <strong className="min-w-0 max-w-full">
            {onOpen ? (
              <Button
                variant="embedded"
                size="embedded"
                className="max-w-full whitespace-normal break-words text-left font-semibold"
                aria-label={openLabel}
                onClick={onOpen}
              >
                {name}
              </Button>
            ) : (
              name
            )}
          </strong>
          <span className="extension-badge">{scopeLabel}</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <p>{description}</p>
          </TooltipTrigger>
          <TooltipContent>{hint ?? description}</TooltipContent>
        </Tooltip>
        {version ? <div className="extension-item__version">v{version}</div> : null}
      </div>
      <div className="extension-item__actions">{actions}</div>
    </li>
  );
}

export function ExtensionRemoveDialog({
  name,
  pending,
  error,
  onClose,
  onConfirm,
  t,
}: Readonly<{
  name: string;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
  t: ExtensionTranslate;
}>) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent closeLabel={t("actions.close")} closeDisabled={pending}>
        <DialogTitle>{t("skillsMarket.center.confirmRemove", { name })}</DialogTitle>
        <DialogDescription>{t("skillsMarket.center.removeHint")}</DialogDescription>
        {error ? <p role="alert">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("skillsMarket.center.cancel")}
          </Button>
          <Button variant="destructive" disabled={pending} aria-busy={pending} onClick={onConfirm}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            {t("skillsMarket.center.remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 开关及禁用原因统一可通过鼠标和键盘查看。 */
export function ExtensionToggle({
  checked,
  disabled,
  label,
  hint,
  onChange,
}: Readonly<{
  checked: boolean;
  disabled: boolean;
  label: string;
  hint: string;
  onChange: (checked: boolean) => void;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" tabIndex={disabled ? 0 : undefined}>
          <Switch.Root
            className="skills-switch"
            aria-label={label}
            checked={checked}
            disabled={disabled}
            onCheckedChange={onChange}
          >
            <Switch.Thumb className="skills-switch__thumb" />
          </Switch.Root>
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
