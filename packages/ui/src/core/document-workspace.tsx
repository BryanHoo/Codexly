import { splitPaneKey } from "@codexly/frontend-core/split-workspace";
import { subscribeTaskChatNavigation } from "@codexly/frontend-core/split-task-navigation";
import { SplitPaneContext } from "./split-workspace.js";
import {
  Activity,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { MessageSquare } from "lucide-react";
import type { WorkspaceDocument } from "@codexly/frontend-core/document-workspace";
import type { useDocumentWorkspace } from "./use-document-workspace.js";
import { DocumentWorkspaceResizer } from "./document-workspace-resizer.js";
import { DocumentNavigationContext, DocumentEditorContext } from "./document-navigation.js";
import type {
  DocumentPresentation,
  DocumentWorkspaceTabs as DocumentWorkspaceTabsComponent,
} from "./document-workspace-tabs.js";

export type { DocumentPresentation } from "./document-workspace-tabs.js";

// 纯聊天无需解析拖动、菜单及对照交互；首次打开文档时再加载增强标签栏。
const DocumentWorkspaceTabs = lazy(() =>
  import("./document-workspace-tabs.js").then((module) => ({
    default: module.DocumentWorkspaceTabs,
  })),
) as typeof DocumentWorkspaceTabsComponent;

const DocumentCloseDialog = lazy(() =>
  import("./document-close-dialog.js").then((module) => ({ default: module.DocumentCloseDialog })),
);

function ClosePrompt({
  registry,
  english,
}: Readonly<{ registry: ReturnType<typeof useDocumentWorkspace>["editors"]; english: boolean }>) {
  const pending = useSyncExternalStore(registry.subscribe, registry.getRequest, () => null);
  return pending ? (
    <Suspense fallback={null}>
      <DocumentCloseDialog registry={registry} english={english} />
    </Suspense>
  ) : null;
}

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
  const selected = workspace.documents.find((document) => document.id === workspace.activeId);
  const direction = !mobile && selected !== undefined ? workspace.direction : null;
  const chatVisible = selected === undefined || direction !== null;
  if (!enabled) return children;
  const chat = locale.startsWith("en") ? "Chat" : "聊天";
  const chatTab = (
    <div className="document-workspace-toolbar">
      <div
        className="document-workspace-tabs"
        role="tablist"
        aria-label={locale.startsWith("en") ? "Workspace tabs" : "工作区标签"}
        ref={tabsRef}
      >
        <div
          className="document-workspace-tab"
          data-chat="true"
          data-pinned="true"
          data-active={workspace.activeId === null}
        >
          <button
            type="button"
            role="tab"
            id={`${id}-tab-0`}
            aria-controls={`${id}-chat`}
            aria-selected={workspace.activeId === null}
            onClick={() => {
              void workspace.select(null);
            }}
          >
            <MessageSquare aria-hidden="true" />
            <span>{chat}</span>
          </button>
        </div>
      </div>
    </div>
  );
  return (
    <div className="document-workspace" data-document-workspace="">
      <ClosePrompt registry={workspace.editors} english={locale.startsWith("en")} />
      {/* 只有聊天时不占用标签栏空间；存在文档时，聊天标签仍固定在首位。 */}
      {hasDocuments ? (
        <Suspense fallback={chatTab}>
          <DocumentWorkspaceTabs
            workspace={workspace}
            describe={describe}
            id={id}
            english={locale.startsWith("en")}
            mobile={mobile}
            tabsRef={tabsRef}
          />
        </Suspense>
      ) : null}
      <div className="document-workspace-body" data-direction={direction ?? "single"} ref={bodyRef}>
        {/* 聊天固定在同一 React 位置；隐藏只暂停视图副作用，任务运行时仍由外层持续接收事件。 */}
        <Activity mode={chatVisible ? "visible" : "hidden"}>
          <div
            className="document-workspace-chat"
            role={hasDocuments ? "tabpanel" : "region"}
            id={`${id}-chat`}
            aria-label={hasDocuments ? undefined : chat}
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
              <DocumentEditorContext value={{ id: selected.id, registry: workspace.editors }}>
                {renderDocument(selected)}
              </DocumentEditorContext>
            </DocumentNavigationContext>
          </div>
        )}
        {direction === null ? null : (
          <DocumentWorkspaceResizer
            direction={direction}
            containerRef={bodyRef}
            label={locale.startsWith("en") ? "Resize chat and document" : "调整聊天与文件大小"}
          />
        )}
      </div>
    </div>
  );
}
