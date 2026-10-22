import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DocumentWorkspace } from "@codexly/ui/core/document-workspace";
import { useDocumentWorkspace } from "@codexly/ui/core/use-document-workspace";
import { SplitWorkspaceProvider, SplitWorkspaceGrid, useSplitWorkspaceActions } from "@codexly/ui/core/split-workspace";
import { requestSplitTaskNavigation } from "@codexly/frontend-core/split-task-navigation";

describe("双端共用中栏标签与聊天对照", () => {
  it("任务导航回到聊天并保留文件标签，普通分屏聚焦不改变文档", () => {
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
  it("等待保存后切换，保存失败保留文件，旧范围的迟到保存不能重新打开标签", async () => {
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
      expect(state!.activeId).toBe("a");
      finish(false);
      await Promise.resolve();
      expect(state!.activeId).toBe("a");
      flushSync(() => { void state!.close("a"); });
      finish(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await expect.poll(() => state!.activeId).toBeNull();
      state!.beforeLeaveRef.current = null;
      flushSync(() => { void state!.open({ id: "a" }); });
      state!.beforeLeaveRef.current = () => new Promise<boolean>((resolve) => { finish = resolve; });
      flushSync(() => { void state!.open({ id: "b" }); });
      flushSync(() => root.render(<View scope="two" />));
      finish(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(state!.documents).toEqual([]);
    } finally { flushSync(() => root.unmount()); host.remove(); }
  });
  it("切换、关闭、对照和根目录切换保留正确状态，只挂载当前文档", () => {
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
      expect(host.querySelector('[role="tablist"]')).toBeNull();
      flushSync(() => { void state!.open({ id: "a.ts" }); });
      expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("a.ts");
      expect(editor.checkVisibility()).toBe(false);
      flushSync(() => { void state!.compare("right"); });
      expect(editor.checkVisibility()).toBe(true);
      expect(host.querySelector('[data-direction="right"]')).not.toBeNull();
      expect(host.querySelector('.document-workspace-actions select')).toBeNull();
      expect(host.querySelectorAll('.document-workspace-actions button')).toHaveLength(3);
      flushSync(() => { void state!.open({ id: "b.ts" }); });
      expect(mounts).toBe(1);
      expect(host.querySelector('[data-file="a.ts"]')).toBeNull();
      flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-label="回到聊天"]')!.click());
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
