import {
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  CircleArrowUp,
  CircleHelp,
  CircleAlert,
  CircleCheck,
  Inbox,
  Keyboard,
  MessageCircle,
  Settings,
  ShieldQuestion,
  Trash2,
  X,
} from "lucide-react";
import * as Popover from "radix-ui/popover";
import * as Tabs from "radix-ui/tabs";
import { useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  getTaskNotificationStore,
  type TaskNotification,
  type TaskNotificationStore,
} from "@codexly/frontend-core/task-notification-store";
import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

export type SidebarFooterLabels = Readonly<
  Record<
    | "settings"
    | "help"
    | "version"
    | "update"
    | "guide"
    | "shortcuts"
    | "notifications"
    | "unread"
    | "read"
    | "markAllRead"
    | "markRead"
    | "clearRead"
    | "empty"
    | "emptyUnread"
    | "emptyRead"
    | "close"
    | "loadMore"
    | "completed"
    | "failed"
    | "approval"
    | "input",
    string
  > &
    Partial<Record<"emptyUnreadDescription" | "emptyReadDescription", string>>
>;

// 共享弹层外观不绑定宽度，帮助菜单按文字长度收缩，通知面板单独设置宽度。
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

const kindIcons = {
  completed: CircleCheck,
  failed: CircleAlert,
  approval: ShieldQuestion,
  input: MessageCircle,
};

/** 单条通知固定为标题与摘要两行，长标题截断，保留完整悬浮文本和可访问名称。 */
function NotificationList({
  items,
  emptyLabel,
  emptyDescription,
  labels,
  onNavigate,
  store,
  formatter,
}: Readonly<{
  items: readonly TaskNotification[];
  emptyLabel: string;
  emptyDescription: string | undefined;
  labels: SidebarFooterLabels;
  onNavigate: (item: TaskNotification) => void;
  store: TaskNotificationStore;
  formatter: Intl.DateTimeFormat;
}>) {
  const [visibleCount, setVisibleCount] = useState(30);
  // 空状态与列表共用内容区；保留完整的图标、标题、说明节奏，低窗口仍由外层限高滚动。
  if (items.length === 0)
    return (
      <div
        className="flex min-h-32 flex-col items-center justify-center px-4 py-4 text-center"
        data-slot="notification-empty"
      >
        <span className="mb-2 flex size-9 items-center justify-center rounded-xl border border-separator bg-control-hover text-muted-foreground">
          <Inbox aria-hidden="true" className="size-5" strokeWidth={1.5} />
        </span>
        <p className="text-body-small font-medium text-foreground">{emptyLabel}</p>
        {emptyDescription ? (
          <p className="mt-1 max-w-56 text-caption leading-relaxed text-muted-foreground">
            {emptyDescription}
          </p>
        ) : null}
      </div>
    );
  return (
    <>
      <ul className="space-y-0.5 p-1.5">
        {items.slice(0, visibleCount).map((item) => {
          const Icon = kindIcons[item.kind];
          return (
            <li
              className="group flex items-center gap-1 rounded-xl pr-1 hover:bg-control-hover focus-within:bg-control-hover"
              key={item.id}
            >
              <Button
                className="h-auto min-w-0 flex-1 items-start gap-2 rounded-xl px-1.5 py-2"
                contentAlign="start"
                variant="ghost"
                onClick={() => {
                  onNavigate(item);
                }}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-xl ${item.kind === "failed" ? "bg-danger/10 text-danger" : item.read ? "bg-panel text-muted-foreground" : "bg-brand-soft text-brand"}`}
                >
                  <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5 text-left">
                  <span
                    title={item.taskName}
                    className={`truncate text-body-small text-foreground ${item.read ? "font-normal" : "font-medium"}`}
                  >
                    {item.taskName}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
                    <span className="shrink-0">{labels[item.kind]}</span>
                    <span aria-hidden="true">·</span>
                    <time
                      className="truncate tabular-nums"
                      dateTime={new Date(item.createdAt).toISOString()}
                    >
                      {formatter.format(item.createdAt)}
                    </time>
                  </span>
                </span>
              </Button>
              {!item.read ? (
                <Hint label={labels.markRead}>
                  <Button
                    aria-label={`${labels.markRead}：${item.taskName}`}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      store.markRead(item.id);
                    }}
                  >
                    <Check aria-hidden="true" className="size-3" />
                  </Button>
                </Hint>
              ) : null}
            </li>
          );
        })}
      </ul>
      {items.length > visibleCount ? (
        <Button
          className="mx-4 mb-3 mt-1"
          size="toolbar"
          variant="ghost"
          onClick={() => {
            setVisibleCount((count) => count + 30);
          }}
        >
          {labels.loadMore}
        </Button>
      ) : null}
    </>
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
  onTaskNavigate,
  locale = "zh-CN",
  store = getTaskNotificationStore(),
  status,
}: Readonly<{
  labels: SidebarFooterLabels;
  version: string;
  updateAvailable?: boolean;
  onSettings: () => void;
  onAbout: () => void;
  onUpdate?: () => void;
  onShortcuts?: () => void;
  onTaskNavigate?: (projectId: string, taskId: string) => void;
  locale?: string;
  store?: TaskNotificationStore;
  status?: string;
}>) {
  const notifications = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const [activeTab, setActiveTab] = useState("unread");
  const { unread, read } = useMemo(() => {
    const unread: TaskNotification[] = [],
      read: TaskNotification[] = [];
    for (const item of notifications) (item.read ? read : unread).push(item);
    return { unread, read };
  }, [notifications]);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );
  const navigate = (item: TaskNotification) => {
    store.markRead(item.id);
    setOpen(false);
    onTaskNavigate?.(item.projectId, item.taskId);
  };
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
        <Popover.Root modal={false} open={open} onOpenChange={setOpen}>
          <Hint label={labels.notifications}>
            <Popover.Trigger asChild>
              <Button
                aria-label={`${labels.notifications}，${String(unread.length)} ${labels.unread}`}
                className="relative"
                id="task-notifications-trigger"
                size="icon-sm"
                variant="ghost"
              >
                <Bell aria-hidden="true" className="size-4" />
                {unread.length > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-4 text-white tabular-nums"
                  >
                    {unread.length > 99 ? "99+" : unread.length}
                  </span>
                ) : null}
              </Button>
            </Popover.Trigger>
          </Hint>
          <Popover.Portal>
            <Popover.Content
              aria-labelledby={titleId}
              align="start"
              side="top"
              sideOffset={10}
              collisionPadding={8}
              className={`${panelClassName} w-[min(20rem,calc(100vw-1rem))] rounded-2xl border-separator`}
            >
              <header className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1 pt-2">
                <div className="flex items-center gap-2">
                  <Bell
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                  <h2 className="text-body-small font-semibold" id={titleId}>
                    {labels.notifications}
                  </h2>
                </div>
                {/* 全部已读属于面板级操作：有未读时始终展示，不受当前 Tab 限制。 */}
                <div className="flex shrink-0 items-center gap-1">
                  {unread.length > 0 ? (
                    <Button
                      aria-label={labels.markAllRead}
                      className="gap-1 rounded-lg px-1.5 text-caption"
                      size="toolbar"
                      variant="ghost"
                      onClick={store.markAllRead}
                    >
                      <CheckCheck aria-hidden="true" className="size-3.5" />
                      {labels.markAllRead}
                    </Button>
                  ) : null}
                  {/* 仅在已读页提供批量删除，复用共享存储保留未读通知与活动去重信息。 */}
                  {activeTab === "read" && read.length > 0 ? (
                    <Button
                      aria-label={labels.clearRead}
                      className="gap-1 rounded-lg px-1.5 text-caption"
                      size="toolbar"
                      variant="ghost"
                      onClick={store.clearRead}
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                      {labels.clearRead}
                    </Button>
                  ) : null}
                  <Popover.Close asChild>
                    <Button
                      aria-label={labels.close}
                      className="-mr-1 rounded-lg"
                      size="icon-toolbar"
                      variant="ghost"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </Button>
                  </Popover.Close>
                </div>
              </header>
              <Tabs.Root
                className="flex min-h-0 flex-col"
                value={activeTab}
                onValueChange={setActiveTab}
              >
                {/* 分段标签占满同一行，面板级操作移至标题栏后，切换 Tab 不再改变标签宽度。 */}
                <div className="flex shrink-0 items-center px-3 pb-2">
                  <Tabs.List
                    aria-label={labels.notifications}
                    className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-control-hover p-0.5"
                  >
                    {(["unread", "read"] as const).map((tab) => (
                      <Tabs.Trigger
                        value={tab}
                        key={tab}
                        className="group/tab inline-flex h-6 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-caption text-muted-foreground outline-none focus-visible:shadow-focus data-[state=active]:bg-raised data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                      >
                        {labels[tab]}{" "}
                        <span className="min-w-5 rounded-md bg-control-hover px-1 text-center text-meta leading-4 tabular-nums group-data-[state=active]/tab:bg-brand-soft group-data-[state=active]/tab:text-brand">
                          {tab === "unread" ? unread.length : read.length}
                        </span>
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </div>
                {(["unread", "read"] as const).map((tab) => (
                  <Tabs.Content
                    key={tab}
                    value={tab}
                    className="min-h-0 overflow-y-auto overscroll-contain outline-none focus-visible:shadow-focus"
                  >
                    <NotificationList
                      items={tab === "unread" ? unread : read}
                      emptyLabel={tab === "unread" ? labels.emptyUnread : labels.emptyRead}
                      emptyDescription={
                        tab === "unread"
                          ? labels.emptyUnreadDescription
                          : labels.emptyReadDescription
                      }
                      labels={labels}
                      onNavigate={navigate}
                      store={store}
                      formatter={formatter}
                    />
                  </Tabs.Content>
                ))}
              </Tabs.Root>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
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
