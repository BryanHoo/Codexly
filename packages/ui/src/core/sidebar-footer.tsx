import { BookOpen, CircleArrowUp, CircleHelp, Keyboard, Settings } from "lucide-react";
import * as Popover from "radix-ui/popover";
import type { ReactNode } from "react";
import { SidebarPageToggleProvider } from "./sidebar-page-toggle.js";
import { Button } from "./button.js";
import { attachFooterPortal } from "./sidebar-footer-portal.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

export type SidebarFooterLabels = Readonly<
  Record<"settings" | "help" | "version" | "update" | "guide" | "shortcuts", string>
>;

const panelClassName =
  "z-50 flex max-h-[min(22.5rem,var(--radix-popover-content-available-height))] flex-col overflow-hidden border bg-raised text-foreground shadow-floating outline-none";

function Hint({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** 底栏只在各入口按钮内响应点击；弹层保持非模态，不添加全屏蒙层或锁定页面滚动。 */
export function SidebarFooter({
  labels,
  version,
  updateAvailable = false,
  onSettings,
  onAbout,
  onUpdate,
  onShortcuts,
  children,
  status,
}: Readonly<{
  labels: SidebarFooterLabels;
  version: string;
  updateAvailable?: boolean;
  onSettings: () => void;
  onAbout: () => void;
  onUpdate?: () => void;
  onShortcuts?: () => void;
  children?: ReactNode;
  status?: string;
}>) {
  return (
    <footer
      className="workbench-status-bar w-full gap-1 text-muted-foreground"
      data-slot="sidebar-footer"
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <Hint label={labels.settings}>
          <Button
            aria-label={labels.settings}
            id="global-settings-trigger"
            size="icon-sm"
            variant="ghost"
            onClick={onSettings}
          >
            <Settings aria-hidden="true" className="size-4" />
          </Button>
        </Hint>
        {/* 由两端注入原有路由入口，统一排列在设置右侧。 */}
        <SidebarPageToggleProvider>{children}</SidebarPageToggleProvider>
        <Popover.Root modal={false}>
          <Hint label={labels.help}>
            <Popover.Trigger asChild>
              <Button
                aria-label={labels.help}
                id="sidebar-help-trigger"
                size="icon-sm"
                variant="ghost"
              >
                <CircleHelp aria-hidden="true" className="size-4" />
              </Button>
            </Popover.Trigger>
          </Hint>
          <Popover.Portal>
            <Popover.Content
              ref={attachFooterPortal}
              aria-label={labels.help}
              align="start"
              side="top"
              sideOffset={10}
              collisionPadding={8}
              className={`${panelClassName} w-max max-w-[calc(100vw-1rem)] rounded-surface border-separator-strong p-1.5`}
            >
              <Button asChild variant="ghost" contentAlign="start">
                <a
                  href="https://github.com/BryanHoo/Codexly/blob/main/docs/usage.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  <BookOpen aria-hidden="true" />
                  {labels.guide}
                </a>
              </Button>
              {onShortcuts ? (
                <Popover.Close asChild>
                  <Button
                    id="keyboard-shortcuts-trigger"
                    variant="ghost"
                    contentAlign="start"
                    onClick={onShortcuts}
                  >
                    <Keyboard aria-hidden="true" />
                    {labels.shortcuts}
                  </Button>
                </Popover.Close>
              ) : null}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <div className="h-7 min-w-2 flex-1" data-testid="sidebar-footer-spacer" />
      <div className="flex shrink-0 items-center gap-0.5">
        <Hint label={status ? `${labels.version} · ${status}` : labels.version}>
          <Button
            aria-label={status ? `${labels.version}，${status}` : labels.version}
            id="global-settings-about-trigger"
            className="px-1.5 font-mono text-caption tabular-nums"
            size="sm"
            variant="ghost"
            onClick={onAbout}
          >
            v{version}
          </Button>
        </Hint>
        {updateAvailable ? (
          <Hint label={labels.update}>
            <Button
              aria-label={labels.update}
              id="app-update-trigger"
              className="gap-1 px-1.5 text-warning"
              size="sm"
              variant="ghost"
              onClick={onUpdate}
            >
              <CircleArrowUp aria-hidden="true" className="size-3.5" />
              {labels.update}
            </Button>
          </Hint>
        ) : null}
      </div>
    </footer>
  );
}
