import { useState, type ReactNode, type RefObject } from "react";
import {
  Columns2,
  FileCode2,
  FileDiff,
  Files,
  GitCommitHorizontal,
  Image,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Rows2,
  X,
} from "lucide-react";
import type { WorkspaceDocument } from "@codexly/frontend-core/document-workspace";
import type { useDocumentWorkspace } from "./use-document-workspace.js";
import { useDocumentTabScroll } from "./use-document-tab-scroll.js";
import { useDocumentTabDrag } from "./use-document-tab-drag.js";
import { DocumentTabMenuItems } from "./document-tab-menu.js";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "./context-menu.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./dropdown-menu.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip.js";

const icons = {
  source: FileCode2,
  image: Image,
  pdf: Files,
  diff: FileDiff,
  review: Files,
  commit: GitCommitHorizontal,
};

export type DocumentPresentation = Readonly<{
  title: string;
  detail: string;
  kind: keyof typeof icons;
}>;

function DocumentAction({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: Readonly<{
  label: string;
  pressed: boolean;
  disabled: boolean;
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
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function DocumentWorkspaceTabs<T extends WorkspaceDocument>({
  workspace,
  describe,
  id,
  english,
  mobile,
  tabsRef,
}: Readonly<{
  workspace: ReturnType<typeof useDocumentWorkspace<T>>;
  describe: (document: T) => DocumentPresentation;
  id: string;
  english: boolean;
  mobile: boolean;
  tabsRef: RefObject<HTMLDivElement | null>;
}>) {
  const [contextId, setContextId] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const tabIds = [null, ...workspace.documents.map((document) => document.id)];
  const pinnedIds = new Set(workspace.pinnedIds);
  const reveal = useDocumentTabScroll(tabsRef, workspace.activeId, workspace.documents);
  const drag = useDocumentTabDrag(
    tabsRef,
    workspace.documents,
    workspace.pinnedIds,
    workspace.reorder,
  );
  const copy = english
    ? {
        chat: "Chat",
        tabs: "Workspace tabs",
        close: "Close",
        unpin: "Unpin",
        pinned: "Pinned",
        more: "Tab Actions",
        right: "Compare with chat side by side",
        down: "Compare with chat above",
      }
    : {
        chat: "聊天",
        tabs: "工作区标签",
        close: "关闭",
        unpin: "取消固定",
        pinned: "已固定",
        more: "标签操作",
        right: "与聊天左右对照",
        down: "与聊天上下对照",
      };
  const focusActive = () => {
    requestAnimationFrame(() => {
      // 最后一个文档关闭后标签栏会隐藏，将焦点交还保留的聊天区域。
      const target =
        tabsRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]') ??
        document.getElementById(`${id}-chat`);
      target?.focus({ preventScroll: true });
    });
  };
  const close = (ids: readonly string[], includePinned = false) => {
    void Promise.resolve(workspace.closeMany(ids, includePinned)).then((closed) => {
      if (closed) focusActive();
    });
  };
  const captureTarget = (target: EventTarget) => {
    if (!(target instanceof Element)) return;
    const tab = target.closest<HTMLElement>(".document-workspace-tab");
    if (tab !== null) setContextId(tab.dataset["documentTabId"] ?? null);
  };
  return (
    <div className="document-workspace-toolbar">
      <ContextMenu onOpenChange={setContextOpen}>
        <ContextMenuTrigger asChild>
          <div
            className="document-workspace-tabs"
            role="tablist"
            aria-label={copy.tabs}
            ref={tabsRef}
            onContextMenuCapture={(event) => {
              captureTarget(event.target);
            }}
            onPointerDownCapture={(event) => {
              if (event.pointerType === "touch") captureTarget(event.target);
            }}
            onDragOver={drag.over}
            onDragLeave={drag.leave}
            onDrop={drag.drop}
            onDragEnd={drag.clear}
            onKeyDown={(event) => {
              if (
                !(event.target instanceof HTMLElement) ||
                event.target.getAttribute("role") !== "tab"
              )
                return;
              const index = tabIds.indexOf(workspace.activeId);
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault();
                const bounds = event.target.getBoundingClientRect();
                event.target.dispatchEvent(
                  new MouseEvent("contextmenu", {
                    bubbles: true,
                    cancelable: true,
                    clientX: bounds.left,
                    clientY: bounds.bottom,
                  }),
                );
                return;
              }
              if (
                event.altKey &&
                event.shiftKey &&
                workspace.activeId !== null &&
                (event.key === "ArrowLeft" || event.key === "ArrowRight")
              ) {
                event.preventDefault();
                event.stopPropagation();
                const offset = event.key === "ArrowLeft" ? -1 : 1;
                const targetId = tabIds[index + offset];
                if (
                  targetId !== undefined &&
                  targetId !== null &&
                  pinnedIds.has(targetId) === pinnedIds.has(workspace.activeId)
                ) {
                  void workspace.reorder(
                    workspace.activeId,
                    targetId,
                    offset === -1 ? "before" : "after",
                  );
                }
                return;
              }
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
                // 保存失败时保持原标签及焦点，不先把焦点移到尚未选中的目标。
                void Promise.resolve(workspace.select(tabIds[next] ?? null)).then((selected) => {
                  if (selected) focusActive();
                });
              } else if (
                event.key === "Delete" &&
                workspace.activeId !== null &&
                !pinnedIds.has(workspace.activeId)
              ) {
                event.preventDefault();
                event.stopPropagation();
                close([workspace.activeId]);
              }
            }}
          >
            {tabIds.map((tabId, index) => {
              const document = workspace.documents[index - 1];
              const presentation = document === undefined ? null : describe(document);
              const title = presentation?.title ?? copy.chat;
              const Icon = presentation === null ? MessageSquare : icons[presentation.kind];
              const active = tabId === workspace.activeId;
              const pinned = tabId === null || pinnedIds.has(tabId);
              return (
                <div
                  className="document-workspace-tab"
                  data-active={active}
                  data-chat={tabId === null}
                  data-pinned={pinned}
                  data-document-tab-id={tabId ?? undefined}
                  key={tabId ?? "chat"}
                  draggable={tabId !== null}
                  onDragStart={
                    tabId === null
                      ? undefined
                      : (event) => {
                          drag.start(tabId, event);
                        }
                  }
                  onAuxClick={(event) => {
                    if (event.button === 1 && tabId !== null) {
                      event.preventDefault();
                      if (!pinned) close([tabId]);
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
                    title={`${presentation?.detail ?? title}${pinned ? ` · ${copy.pinned}` : ""}`}
                    onClick={() => {
                      if (active) reveal();
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
                      aria-label={`${pinned ? copy.unpin : copy.close} ${title}`}
                      title={`${pinned ? copy.unpin : copy.close} ${title}`}
                      onClick={() => {
                        if (pinned) void workspace.pin(tabId, false);
                        else close([tabId]);
                      }}
                    >
                      {pinned ? <Pin aria-hidden="true" /> : <X aria-hidden="true" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusActive();
          }}
        >
          {contextOpen ? (
            <DocumentTabMenuItems
              workspace={workspace}
              tabId={contextId}
              english={english}
              mobile={mobile}
              onClose={close}
            />
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
      <TooltipProvider>
        <div className="document-workspace-actions">
          {!mobile ? (
            <>
              <DocumentAction
                label={copy.right}
                disabled={workspace.activeId === null}
                pressed={workspace.direction === "right"}
                onClick={() => {
                  void workspace.compare(workspace.direction === "right" ? null : "right");
                }}
              >
                <Columns2 aria-hidden="true" />
              </DocumentAction>
              <DocumentAction
                label={copy.down}
                disabled={workspace.activeId === null}
                pressed={workspace.direction === "down"}
                onClick={() => {
                  void workspace.compare(workspace.direction === "down" ? null : "down");
                }}
              >
                <Rows2 aria-hidden="true" />
              </DocumentAction>
            </>
          ) : null}
          <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={copy.more} title={copy.more}>
                <MoreHorizontal aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {moreOpen ? (
                <DocumentTabMenuItems
                  workspace={workspace}
                  tabId={workspace.activeId}
                  english={english}
                  mobile={mobile}
                  dropdown
                  onClose={close}
                />
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TooltipProvider>
    </div>
  );
}
