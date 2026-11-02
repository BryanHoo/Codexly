import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DocumentWorkspace } from "@codexly/ui/core/document-workspace";
import { useDocumentWorkspace } from "@codexly/ui/core/use-document-workspace";
import { SplitWorkspaceProvider, SplitWorkspaceGrid, useSplitWorkspaceActions } from "@codexly/ui/core/split-workspace";
import { requestSplitTaskNavigation } from "@codexly/frontend-core/split-task-navigation";
import { TerminalContext, TerminalFooter } from "../../../features/terminal/components/terminal-context.js";

describe("双端共用中栏标签与聊天对照", () => {
  it("文件标签隐藏外置底栏，返回聊天或并排对照时恢复且保留草稿", async () => {
    const host = document.createElement("div");
    const footer = document.createElement("div");
    document.body.append(host, footer);
    const root = createRoot(host);
    let state: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
    function View() {
      const workspace = useDocumentWorkspace<{ id: string }>("footer-visibility");
      useLayoutEffect(() => { state = workspace; }, [workspace]);
      return <TerminalContext value={{ projectId: "project", rootId: undefined, footer,
        toggle: () => undefined, captureFocus: () => undefined }}>
        <DocumentWorkspace workspace={workspace} locale="zh-CN"
          describe={(doc) => ({ title: doc.id, detail: doc.id, kind: "source" })}
          renderDocument={(doc) => <div>{doc.id}</div>}>
          <textarea aria-label="聊天草稿" />
          <TerminalFooter><button>分支、项目路径、上下文</button></TerminalFooter>
        </DocumentWorkspace>
      </TerminalContext>;
    }
    try {
      flushSync(() => root.render(<View />));
      const editor = host.querySelector("textarea")!;
      editor.value = "保留聊天草稿";
      expect(footer.textContent).toContain("分支、项目路径、上下文");
      flushSync(() => { void state!.open({ id: "a.ts" }); });
      // 外置 Portal 不在 Activity 的 DOM 隐藏边界内，必须单独跟随聊天可见性。
      await expect.poll(() => footer.querySelector("button")).toBeNull();
      flushSync(() => { void state!.select(null); });
      await expect.poll(() => footer.textContent).toContain("分支、项目路径、上下文");
      expect(host.querySelector("textarea")).toBe(editor);
      expect(editor.value).toBe("保留聊天草稿");
      flushSync(() => { void state!.open({ id: "a.ts" }); void state!.compare("right"); });
      await expect.poll(() => footer.textContent).toContain("分支、项目路径、上下文");
      expect(editor.checkVisibility()).toBe(true);
      flushSync(() => { void state!.compare(null); });
      await expect.poll(() => footer.querySelector("button")).toBeNull();
    } finally { flushSync(() => root.unmount()); host.remove(); footer.remove(); }
  });
  it("任务导航回到聊天并保留文件标签，普通分屏聚焦不改变文档", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const first = { projectId: "project", taskId: "first" };
    const second = { projectId: "project", taskId: "second" };
    let actions: NonNullable<ReturnType<typeof useSplitWorkspaceActions>>;
    const states = new Map<string, ReturnType<typeof useDocumentWorkspace<{ id: string }>>>();
    function Pane({ taskId }: { taskId: string }) {
      const workspace = useDocumentWorkspace<{ id: string }>(taskId);
      useLayoutEffect(() => { states.set(taskId, workspace); }, [taskId, workspace]);
      return <DocumentWorkspace workspace={workspace} locale="zh-CN" describe={(doc) => ({ title: doc.id, detail: doc.id, kind: "source" })} renderDocument={(doc) => <div>{doc.id}</div>}><textarea /></DocumentWorkspace>;
    }
    function View() {
      const value = useSplitWorkspaceActions()!;
      useLayoutEffect(() => { actions = value; }, [value]);
      return <SplitWorkspaceGrid sidebarOpen toggleSidebar={() => undefined} label="任务" splitLabels={{up:"上",down:"下",left:"左",right:"右",limit:"上限"}}>{(pane) => <Pane taskId={pane.taskId!} />}</SplitWorkspaceGrid>;
    }
    try {
      flushSync(() => root.render(<SplitWorkspaceProvider current={first} routeKey="first" desktop><View /></SplitWorkspaceProvider>));
      flushSync(() => actions.add(second));
      flushSync(() => { void states.get("first")!.open({id:"a.ts"}); void states.get("second")!.open({id:"b.ts"}); });
      flushSync(() => actions.focus(first));
      expect(states.get("first")!.activeId).toBe("a.ts");
      flushSync(() => actions.select(second));
      expect(states.get("second")!.activeId).toBeNull();
      expect(states.get("second")!.documents).toHaveLength(1);
      expect(states.get("first")!.activeId).toBe("a.ts");
      flushSync(() => requestSplitTaskNavigation(first));
      expect(states.get("first")!.activeId).toBeNull();
      expect(states.get("first")!.documents).toHaveLength(1);
    } finally { flushSync(() => root.unmount()); host.remove(); }
  });
  it("切换不触发保存保护，关闭失败保留文件，旧范围迟到关闭不能影响新标签", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let state: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
    function View({ scope }: { scope: string }) {
      const workspace = useDocumentWorkspace<{ id: string }>(scope);
      useLayoutEffect(() => { state = workspace; }, [workspace]);
      return null;
    }
    try {
      flushSync(() => root.render(<View scope="one" />));
      flushSync(() => { void state!.open({ id: "a" }); });
      let finish!: (saved: boolean) => void;
      state!.beforeLeaveRef.current = () => new Promise<boolean>((resolve) => { finish = resolve; });
      flushSync(() => { void state!.open({ id: "b" }); });
      expect(state!.activeId).toBe("b");
      flushSync(() => { void state!.close("b"); });
      finish(false);
      await Promise.resolve();
      expect(state!.activeId).toBe("b");
      flushSync(() => { void state!.close("b"); });
      finish(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await expect.poll(() => state!.activeId).toBe("a");
      state!.beforeLeaveRef.current = null;
      flushSync(() => { void state!.open({ id: "a" }); });
      state!.beforeLeaveRef.current = () => new Promise<boolean>((resolve) => { finish = resolve; });
      flushSync(() => { void state!.close("a"); });
      flushSync(() => root.render(<View scope="two" />));
      finish(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(state!.documents).toEqual([]);
    } finally { flushSync(() => root.unmount()); host.remove(); }
  });
  it("切换、关闭、对照和根目录切换保留正确状态，只挂载当前文档", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let state: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
    let mounts = 0;
    function File({ id }: { id: string }) {
      useLayoutEffect(() => { mounts += 1; return () => { mounts -= 1; }; }, []);
      return <div data-file={id}>{id}</div>;
    }
    function View({ scope }: { scope: string }) {
      const workspace = useDocumentWorkspace<{ id: string }>(scope);
      useLayoutEffect(() => { state = workspace; }, [workspace]);
      return <DocumentWorkspace workspace={workspace} locale="zh-CN"
        describe={(document) => ({ title: document.id, detail: document.id, kind: "source" })}
        renderDocument={(document) => <File id={document.id} />}>
        <textarea aria-label="聊天草稿" />
      </DocumentWorkspace>;
    }
    try {
      flushSync(() => root.render(<View scope="first" />));
      const editor = host.querySelector("textarea")!;
      editor.value = "保留聊天草稿";
      expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
      flushSync(() => { void state!.open({ id: "a.ts" }); });
      // 首次标签通过 Suspense 懒加载，冷缓存下的模块转换可能超过默认轮询时间。
      await expect.poll(() => host.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "", { timeout: 5_000 }).toContain("a.ts");
      expect(editor.checkVisibility()).toBe(false);
      flushSync(() => { void state!.compare("right"); });
      expect(editor.checkVisibility()).toBe(true);
      expect(host.querySelector('[data-direction="right"]')).not.toBeNull();
      expect(host.querySelector('.document-workspace-actions select')).toBeNull();
      expect(host.querySelectorAll('.document-workspace-actions button')).toHaveLength(3);
      flushSync(() => { void state!.open({ id: "b.ts" }); });
      expect(mounts).toBe(1);
      expect(host.querySelector('[data-file="a.ts"]')).toBeNull();
      flushSync(() => host.querySelector<HTMLButtonElement>('button[role="tab"][aria-controls$="-chat"]')!.click());
      expect(host.querySelector("textarea")).toBe(editor);
      expect(editor.value).toBe("保留聊天草稿");
      expect(mounts).toBe(0);
      const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      flushSync(() => tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
      expect(state!.activeId).toBe("b.ts");
      flushSync(() => { void state!.close("b.ts"); });
      expect(state!.activeId).toBe("a.ts");
      flushSync(() => root.render(<View scope="second" />));
      expect(state!.documents).toEqual([]);
      expect(mounts).toBe(0);
      expect(host.querySelector("textarea")).toBe(editor);
    } finally {
      flushSync(() => root.unmount());
      host.remove();
    }
  });
});
