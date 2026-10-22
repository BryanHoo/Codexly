import { splitPaneKey } from "@codexly/frontend-core/split-workspace";
import { subscribeTaskChatNavigation } from "@codexly/frontend-core/split-task-navigation";
import { SplitPaneContext } from "./split-workspace.js";
import {
  Activity,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Columns2,
  FileCode2,
  FileDiff,
  Files,
  Focus,
  GitCommitHorizontal,
  Image,
  MessageSquare,
  Rows2,
  X,
} from "lucide-react";
import type { WorkspaceDocument } from "@codexly/frontend-core/document-workspace";
import type { useDocumentWorkspace } from "./use-document-workspace.js";
import { DocumentWorkspaceResizer } from "./document-workspace-resizer.js";
import { DocumentNavigationContext } from "./document-navigation.js";
import { useDocumentTabScroll } from "./use-document-tab-scroll.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip.js";

const mobileQuery = "(max-width: 760px), (hover: none) and (pointer: coarse)";
function subscribeMobile(listener: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}
const getMobile = () => window.matchMedia(mobileQuery).matches;
const getServerMobile = () => false;
export type DocumentPresentation = Readonly<{
  title: string;
  detail: string;
  kind: "source" | "image" | "pdf" | "diff" | "review" | "commit";
}>;
const icons = {
  source: FileCode2,
  image: Image,
  pdf: Files,
  diff: FileDiff,
  review: Files,
  commit: GitCommitHorizontal,
};

function DocumentAction({
  label,
  pressed,
  disabled = false,
  onClick,
  children,
}: Readonly<{
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          aria-disabled={disabled || undefined}
          onClick={() => {
            if (!disabled) onClick();
          }}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function DocumentWorkspace<T extends WorkspaceDocument>({
  children,
  workspace,
  describe,
  renderDocument,
  locale,
  enabled = true,
}: Readonly<{
  children: ReactNode;
  workspace: ReturnType<typeof useDocumentWorkspace<T>>;
  describe: (document: T) => DocumentPresentation;
  renderDocument: (document: T) => ReactNode;
  locale: string;
  enabled?: boolean;
}>) {
  const pane = useContext(SplitPaneContext)?.pane;
  const taskKey = pane === undefined ? undefined : splitPaneKey(pane);
  const hasDocuments = workspace.documents.length > 0;
  const revealChat = useEffectEvent(() => {
    void workspace.select(null);
  });
  useEffect(() => {
    // 只为带文档的任务登记导航监听，不订阅其他窗口焦点或聊天正文。
    if (taskKey === undefined || !hasDocuments) return;
    return subscribeTaskChatNavigation(taskKey, revealChat);
  }, [taskKey, hasDocuments]);
  const mobile = useSyncExternalStore(subscribeMobile, getMobile, getServerMobile);
  const id = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const english = locale.startsWith("en");
  const copy = english
    ? {
        chat: "Chat",
        tabs: "Workspace tabs",
        close: "Close",
        right: "Compare with chat side by side",
        down: "Compare with chat above",
        focus: "Back to chat",
        resize: "Resize chat and document",
      }
    : {
        chat: "聊天",
        tabs: "工作区标签",
        close: "关闭",
        right: "与聊天左右对照",
        down: "与聊天上下对照",
        focus: "回到聊天",
        resize: "调整聊天与文件大小",
      };
  const selected = workspace.documents.find((document) => document.id === workspace.activeId);
  const direction = !mobile && selected !== undefined ? workspace.direction : null;
  const chatVisible = selected === undefined || direction !== null;
  const tabIds = [null, ...workspace.documents.map((document) => document.id)];
  const revealActiveTab = useDocumentTabScroll(
    tabsRef,
    workspace.activeId,
    workspace.documents.length,
  );
  if (!enabled) return children;
  return (
    <div className="document-workspace" data-document-workspace="">
      {hasDocuments ? (
        <div className="document-workspace-toolbar">
          <div
            className="document-workspace-tabs"
            role="tablist"
            aria-label={copy.tabs}
            ref={tabsRef}
            onKeyDown={(event) => {
              if (
                !(event.target instanceof HTMLElement) ||
                event.target.getAttribute("role") !== "tab"
              )
                return;
              const index = tabIds.indexOf(workspace.activeId);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % tabIds.length
                  : event.key === "ArrowLeft"
                    ? (index - 1 + tabIds.length) % tabIds.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabIds.length - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                event.stopPropagation();
                void workspace.select(tabIds[next] ?? null);
                tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
              } else if (event.key === "Delete" && workspace.activeId !== null) {
                event.preventDefault();
                void workspace.close(workspace.activeId);
                requestAnimationFrame(() =>
                  tabsRef.current
                    ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
                    ?.focus(),
                );
              }
            }}
          >
            {tabIds.map((tabId, index) => {
              const document = workspace.documents[index - 1];
              const presentation = document === undefined ? null : describe(document);
              const title = presentation?.title ?? copy.chat;
              const Icon = presentation === null ? MessageSquare : icons[presentation.kind];
              const active = tabId === workspace.activeId;
              return (
                <div
                  className="document-workspace-tab"
                  data-active={active}
                  data-chat={tabId === null}
                  key={tabId ?? "chat"}
                  onAuxClick={(event) => {
                    if (event.button === 1 && tabId !== null) {
                      event.preventDefault();
                      void workspace.close(tabId);
                    }
                  }}
                >
                  <button
                    type="button"
                    role="tab"
                    id={`${id}-tab-${String(index)}`}
                    aria-controls={`${id}-${tabId === null ? "chat" : "document"}`}
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    title={presentation?.detail ?? title}
                    onClick={() => {
                      // 重复点击当前标签也重新居中，不依赖选中 ID 发生变化。
                      if (active) revealActiveTab();
                      void workspace.select(tabId);
                    }}
                  >
                    <Icon aria-hidden="true" />
                    <span>{title}</span>
                  </button>
                  {tabId === null ? null : (
                    <button
                      type="button"
                      className="document-workspace-tab-close"
                      aria-label={`${copy.close} ${title}`}
                      title={`${copy.close} ${title}`}
                      onClick={() => {
                        void workspace.close(tabId);
                        requestAnimationFrame(() =>
                          tabsRef.current
                            ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
                            ?.focus(),
                        );
                      }}
                    >
                      <X aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <TooltipProvider>
            <div className="document-workspace-actions">
              {!mobile ? (
                <>
                  <DocumentAction
                    label={copy.right}
                    disabled={selected === undefined}
                    pressed={direction === "right"}
                    onClick={() => {
                      void workspace.compare(direction === "right" ? null : "right");
                    }}
                  >
                    <Columns2 aria-hidden="true" />
                  </DocumentAction>
                  <DocumentAction
                    label={copy.down}
                    disabled={selected === undefined}
                    pressed={direction === "down"}
                    onClick={() => {
                      void workspace.compare(direction === "down" ? null : "down");
                    }}
                  >
                    <Rows2 aria-hidden="true" />
                  </DocumentAction>
                </>
              ) : null}
              <DocumentAction
                label={copy.focus}
                onClick={() => {
                  // 等待文件保存成功再返回聊天，并把键盘焦点交还聊天标签。
                  void Promise.resolve(workspace.select(null)).then((selected) => {
                    if (!selected) return;
                    requestAnimationFrame(() => {
                      tabsRef.current
                        ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
                        ?.focus({ preventScroll: true });
                    });
                  });
                }}
              >
                <Focus aria-hidden="true" />
              </DocumentAction>
            </div>
          </TooltipProvider>
        </div>
      ) : null}
      <div className="document-workspace-body" data-direction={direction ?? "single"} ref={bodyRef}>
        {/* 聊天固定在同一 React 位置；隐藏只暂停视图副作用，任务运行时仍由外层持续接收事件。 */}
        <Activity mode={chatVisible ? "visible" : "hidden"}>
          <div
            className="document-workspace-chat"
            role={hasDocuments ? "tabpanel" : "region"}
            id={`${id}-chat`}
            aria-label={hasDocuments ? undefined : copy.chat}
            aria-labelledby={hasDocuments ? `${id}-tab-0` : undefined}
            tabIndex={0}
          >
            {children}
          </div>
        </Activity>
        {selected === undefined ? null : (
          <div
            className="document-workspace-document"
            role="tabpanel"
            id={`${id}-document`}
            aria-labelledby={`${id}-tab-${String(workspace.documents.indexOf(selected) + 1)}`}
            tabIndex={0}
            key={selected.id}
          >
            {/* 一次仅挂载当前文档；不为后台标签加载图片、PDF、diff 或额外编辑器。 */}
            <DocumentNavigationContext value={workspace.beforeLeaveRef}>
              {renderDocument(selected)}
            </DocumentNavigationContext>
          </div>
        )}
        {direction === null ? null : (
          <DocumentWorkspaceResizer
            direction={direction}
            containerRef={bodyRef}
            label={copy.resize}
          />
        )}
      </div>
    </div>
  );
}
