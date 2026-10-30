import "../../styles/globals.css";
import "@codexly/ui/core/document-workspace.css";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DocumentWorkspace } from "@codexly/ui/core/document-workspace";
import { useDocumentWorkspace } from "@codexly/ui/core/use-document-workspace";
import { useDocumentWorkspaceNavigation } from "@codexly/ui/core/document-workspace-navigation";
import { createMemoryHistory } from "@tanstack/react-router";
import { userEvent } from "vitest/browser";
import { SplitWorkspaceProvider, SplitWorkspaceGrid, useSplitWorkspaceActions } from "@codexly/ui/core/split-workspace";

function draft(path: string) {
  let dirty = true;
  const listeners = new Set<() => void>();
  const clean = () => { dirty = false; for (const listener of listeners) listener(); return true; };
  return { path, isDirty: () => dirty, isSaving: () => false, save: vi.fn(async () => clean()), discard: vi.fn(clean), subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}

const presentation = (doc: { id: string }) => ({ title: doc.id, detail: doc.id, kind: "source" as const });
const dialogButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === text)!;

it("同项目任务变化只回聊天，保留固定标签与后台草稿而不请求关闭", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let state!: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
  function View({ task }: { task: string }) {
    const workspace = useDocumentWorkspace<{ id: string }>("project", task);
    useLayoutEffect(() => { state = workspace; });
    return <DocumentWorkspace workspace={workspace} locale="zh-CN" describe={(doc) => ({ title: doc.id, detail: doc.id, kind: "source" })} renderDocument={(doc) => <div>{doc.id}</div>}><textarea aria-label="聊天" /></DocumentWorkspace>;
  }
  try {
    flushSync(() => root.render(<View task="first" />));
    flushSync(() => { void state.open({ id: "a.txt" }); void state.pin("a.txt", true); void state.compare("right"); });
    const close = vi.spyOn(state.editors, "requestClose");
    flushSync(() => root.render(<View task="second" />));
    expect(state.activeId).toBeNull();
    expect(state.direction).toBeNull();
    expect(state.documents.map((doc) => doc.id)).toEqual(["a.txt"]);
    expect(state.pinnedIds).toEqual(["a.txt"]);
    expect(close).not.toHaveBeenCalled();
  } finally { flushSync(() => root.unmount()); host.remove(); }
});

it("普通路由同项目免确认，跨项目汇总后台草稿；取消、保存失败及成功均作用于原文件", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const history = createMemoryHistory({ initialEntries: ["/p/project/t/first"] });
  let state!: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
  function View() {
    const path = useSyncExternalStore(history.subscribe, () => history.location.pathname);
    const workspace = useDocumentWorkspace<{ id: string }>(path.split("/")[2]!, path);
    useDocumentWorkspaceNavigation(workspace, history, path.split("/")[2]!);
    useLayoutEffect(() => { state = workspace; });
    return <DocumentWorkspace workspace={workspace} locale="zh-CN" describe={presentation} renderDocument={(doc) => <div>{doc.id}</div>}><textarea /></DocumentWorkspace>;
  }
  try {
    flushSync(() => root.render(<View />));
    const a = draft("a.txt"), b = draft("b.txt");
    flushSync(() => { void state.open({id:"a"}); void state.open({id:"b"}); state.editors.register("a", a); state.editors.register("b", b); });
    history.push("/p/project/t/second");
    await expect.poll(() => state.activeId).toBeNull();
    expect(state.documents).toHaveLength(2);
    expect(state.editors.getRequest()).toBeNull();
    expect(a.save).not.toHaveBeenCalled(); expect(b.save).not.toHaveBeenCalled();
    history.push("/p/other/t/third");
    await expect.poll(() => document.querySelector('[role="dialog"]')?.textContent ?? "", { timeout: 10000 }).toContain("切换项目前保存更改");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("关闭当前文件标签");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("a.txt");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("b.txt");
    await userEvent.click(dialogButton("取消"));
    expect(history.location.pathname).toBe("/p/project/t/second");
    expect(state.documents).toHaveLength(2);
    b.save.mockResolvedValueOnce(false);
    history.push("/p/other/t/third");
    await expect.poll(() => dialogButton("全部保存")).toBeTruthy();
    await userEvent.click(dialogButton("全部保存"));
    await expect.poll(() => state.activeId).toBe("b");
    expect(history.location.pathname).toBe("/p/project/t/second");
    expect(state.documents).toHaveLength(2);
    history.push("/p/other/t/third");
    await expect.poll(() => dialogButton("保存")).toBeTruthy();
    await userEvent.click(dialogButton("保存"));
    await expect.poll(() => history.location.pathname).toBe("/p/other/t/third");
    await expect.poll(() => state.documents).toHaveLength(0);
    expect(a.save).toHaveBeenCalledTimes(1); expect(b.save).toHaveBeenCalledTimes(2);
  } finally { flushSync(() => root.unmount()); host.remove(); }
});

it("分屏原位换同项目任务保留标签，跨项目只确认被替换窗口，不保存后关闭其标签", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const states = new Map<string, ReturnType<typeof useDocumentWorkspace<{ id: string }>>>();
  let actions!: NonNullable<ReturnType<typeof useSplitWorkspaceActions>>;
  function Pane({ projectId, taskId }: { projectId: string; taskId: string }) {
    const workspace = useDocumentWorkspace<{ id: string }>(projectId, taskId);
    useDocumentWorkspaceNavigation(workspace, undefined, projectId);
    useLayoutEffect(() => { states.set(taskId, workspace); });
    return <DocumentWorkspace workspace={workspace} locale="zh-CN" describe={presentation} renderDocument={(doc) => <div>{doc.id}</div>}><textarea /></DocumentWorkspace>;
  }
  function Grid() {
    const value = useSplitWorkspaceActions()!;
    useLayoutEffect(() => { actions = value; });
    return <SplitWorkspaceGrid sidebarOpen toggleSidebar={() => undefined} label="任务" splitLabels={{up:"上",down:"下",left:"左",right:"右",limit:"上限"}}>{(pane) => <Pane projectId={pane.projectId} taskId={pane.taskId!} />}</SplitWorkspaceGrid>;
  }
  const first = {projectId:"project",taskId:"first"}, neighbor = {projectId:"project",taskId:"neighbor"};
  try {
    flushSync(() => root.render(<SplitWorkspaceProvider current={first} routeKey="first" desktop><Grid /></SplitWorkspaceProvider>));
    flushSync(() => { actions.add(neighbor); });
    const file = draft("a.txt");
    flushSync(() => { void states.get("first")!.open({id:"a"}); states.get("first")!.editors.register("a",file); actions.focus(first); });
    flushSync(() => { actions.select({projectId:"project",taskId:"second"}); });
    expect(states.get("second")!.documents).toHaveLength(1);
    expect(states.get("second")!.activeId).toBeNull();
    expect(file.save).not.toHaveBeenCalled();
    flushSync(() => { actions.select({projectId:"other",taskId:"third"}); });
    await expect.poll(() => dialogButton("不保存")).toBeTruthy();
    expect(states.has("third")).toBe(false);
    await userEvent.click(dialogButton("不保存"));
    await expect.poll(() => states.get("third")?.documents).toEqual([]);
    expect(states.get("neighbor")!.documents).toHaveLength(0);
    expect(file.discard).toHaveBeenCalledTimes(1); expect(file.save).not.toHaveBeenCalled();
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
