import type { WorkspaceDocument } from "@codexly/frontend-core/document-workspace";
import type { useDocumentWorkspace } from "./use-document-workspace.js";
import { ContextMenuItem, ContextMenuSeparator } from "./context-menu.js";
import { DropdownMenuItem, DropdownMenuSeparator } from "./dropdown-menu.js";

export function DocumentTabMenuItems<T extends WorkspaceDocument>({
  workspace,
  tabId,
  english,
  mobile,
  dropdown = false,
  onClose,
}: Readonly<{
  workspace: ReturnType<typeof useDocumentWorkspace<T>>;
  tabId: string | null;
  english: boolean;
  mobile: boolean;
  dropdown?: boolean;
  onClose: (ids: readonly string[], includePinned?: boolean) => void;
}>) {
  const Item = dropdown ? DropdownMenuItem : ContextMenuItem;
  const Separator = dropdown ? DropdownMenuSeparator : ContextMenuSeparator;
  const copy = english
    ? {
        pin: "Pin",
        unpin: "Unpin",
        close: "Close",
        others: "Close Other Tabs",
        left: "Close Tabs to the Left",
        right: "Close Tabs to the Right",
        all: "Close All Tabs",
        unpinned: "Close Unpinned Tabs",
        pinned: "Close Pinned Tabs",
        moveLeft: "Move Tab Left",
        moveRight: "Move Tab Right",
        compareRight: "Compare with Chat Side by Side",
        compareDown: "Compare with Chat Above",
        stopCompare: "Stop Comparing",
      }
    : {
        pin: "固定",
        unpin: "取消固定",
        close: "关闭",
        others: "关闭其他标签",
        left: "关闭左侧标签",
        right: "关闭右侧标签",
        all: "关闭所有标签",
        unpinned: "关闭未固定标签",
        pinned: "关闭固定标签",
        moveLeft: "向左移动标签",
        moveRight: "向右移动标签",
        compareRight: "与聊天左右对照",
        compareDown: "与聊天上下对照",
        stopCompare: "结束对照",
      };
  const ids = workspace.documents.map((document) => document.id);
  const index = tabId === null ? -1 : ids.indexOf(tabId);
  const pinned = new Set(workspace.pinnedIds);
  const isDocument = tabId !== null && index !== -1;
  const unpinned = ids.filter((id) => !pinned.has(id));
  const others = unpinned.filter((id) => id !== tabId);
  const left = ids.slice(0, index).filter((id) => !pinned.has(id));
  const right = ids.slice(index + 1).filter((id) => !pinned.has(id));
  const canMove = (offset: number) => {
    const targetId = ids[index + offset];
    return isDocument && targetId !== undefined && pinned.has(targetId) === pinned.has(tabId);
  };
  const move = (offset: number) => {
    const targetId = ids[index + offset];
    if (tabId === null || targetId === undefined || !canMove(offset)) return;
    void workspace.reorder(tabId, targetId, offset === -1 ? "before" : "after");
  };
  const compare = async (direction: "right" | "down") => {
    // 右键后台标签不抢焦点，只有明确选择对照时才等待保存并切换到该文档。
    if (tabId !== null && (await workspace.select(tabId))) void workspace.compare(direction);
  };
  return (
    <>
      {isDocument ? (
        <>
          <Item
            onSelect={() => {
              void workspace.pin(tabId, !pinned.has(tabId));
            }}
          >
            {pinned.has(tabId) ? copy.unpin : copy.pin}
          </Item>
          <Item
            disabled={!canMove(-1)}
            onSelect={() => {
              move(-1);
            }}
          >
            {copy.moveLeft}
          </Item>
          <Item
            disabled={!canMove(1)}
            onSelect={() => {
              move(1);
            }}
          >
            {copy.moveRight}
          </Item>
          <Separator />
          <Item
            onSelect={() => {
              onClose([tabId], true);
            }}
          >
            {copy.close}
          </Item>
          <Item
            disabled={others.length === 0}
            onSelect={() => {
              onClose(others);
            }}
          >
            {copy.others}
          </Item>
          <Item
            disabled={left.length === 0}
            onSelect={() => {
              onClose(left);
            }}
          >
            {copy.left}
          </Item>
          <Item
            disabled={right.length === 0}
            onSelect={() => {
              onClose(right);
            }}
          >
            {copy.right}
          </Item>
        </>
      ) : null}
      <Item
        disabled={unpinned.length === 0}
        onSelect={() => {
          onClose(unpinned);
        }}
      >
        {copy.all}
      </Item>
      <Item
        disabled={unpinned.length === 0}
        onSelect={() => {
          onClose(unpinned);
        }}
      >
        {copy.unpinned}
      </Item>
      <Item
        disabled={pinned.size === 0}
        onSelect={() => {
          onClose(workspace.pinnedIds, true);
        }}
      >
        {copy.pinned}
      </Item>
      {!mobile && isDocument ? (
        <>
          <Separator />
          <Item
            onSelect={() => {
              void compare("right");
            }}
          >
            {copy.compareRight}
          </Item>
          <Item
            onSelect={() => {
              void compare("down");
            }}
          >
            {copy.compareDown}
          </Item>
          <Item
            disabled={workspace.direction === null}
            onSelect={() => {
              void workspace.compare(null);
            }}
          >
            {copy.stopCompare}
          </Item>
        </>
      ) : null}
    </>
  );
}
