import { expect, it, vi } from "vitest";
import { DocumentEditorRegistry } from "./document-editor-registry.js";

function entry() {
  let dirty = true;
  const listeners = new Set<() => void>();
  const change = (next: boolean) => {
    dirty = next;
    listeners.forEach((listen) => {
      listen();
    });
  };
  return {
    path: "notes.md",
    isDirty: () => dirty,
    isSaving: () => false,
    save: vi.fn(() => {
      change(false);
      return Promise.resolve(true);
    }),
    discard: vi.fn(() => {
      change(false);
      return true;
    }),
    subscribe: (listen: () => void) => {
      listeners.add(listen);
      return () => {
        listeners.delete(listen);
      };
    },
    change,
  };
}
it("后台标签保留脏状态，取消关闭不保存也不丢弃", async () => {
  const registry = new DocumentEditorRegistry();
  const file = entry();
  registry.register("a", file);
  const closing = registry.requestClose(["a"]);
  expect(registry.isDirty("a")).toBe(true);
  expect(registry.getRequest()?.entries.map((item) => item.id)).toEqual(["a"]);
  await registry.resolveClose("cancel");
  expect(await closing).toBe(false);
  expect(file.save).not.toHaveBeenCalled();
  expect(file.discard).not.toHaveBeenCalled();
  registry.dispose();
});
it("批量关闭先处理全部脏文件，保存失败整批保留并指出失败文件", async () => {
  const registry = new DocumentEditorRegistry();
  const a = entry();
  const b = entry();
  b.save.mockResolvedValue(false);
  registry.register("a", a);
  registry.register("b", b);
  const closing = registry.requestClose(["a", "b"]);
  await registry.resolveClose("save");
  expect(await closing).toBe(false);
  expect(registry.failedId).toBe("b");
  expect(registry.isDirty("a")).toBe(false);
  expect(registry.isDirty("b")).toBe(true);
  const discard = registry.requestClose(["b"]);
  await registry.resolveClose("discard");
  expect(await discard).toBe(true);
  expect(b.discard).toHaveBeenCalledOnce();
  registry.dispose();
});
it("状态订阅只在脏状态改变时发布，移除标签释放订阅", () => {
  const registry = new DocumentEditorRegistry();
  const file = entry();
  registry.register("a", file);
  const notify = vi.fn();
  registry.subscribe(notify);
  file.change(true);
  expect(notify).not.toHaveBeenCalled();
  file.change(false);
  expect(notify).toHaveBeenCalledOnce();
  registry.retainOnly([]);
  notify.mockClear();
  file.change(true);
  expect(notify).not.toHaveBeenCalled();
  registry.dispose();
});
it("关闭确认期间后续导航取消旧请求，不触发写盘", async () => {
  const registry = new DocumentEditorRegistry();
  const file = entry();
  registry.register("a", file);
  const closing = registry.requestClose(["a"]);
  registry.cancelClose();
  expect(await closing).toBe(false);
  expect(registry.getRequest()).toBeNull();
  expect(file.save).not.toHaveBeenCalled();
  registry.dispose();
});

it("后台已保存标签不持有正文会话，未保存标签保留到保存完成", () => {
  const registry = new DocumentEditorRegistry();
  const file = entry();
  registry.register("a", file);
  registry.detach("a", file);
  expect(registry.isDirty("a")).toBe(true);
  file.change(false);
  file.change(true);
  expect(registry.isDirty("a")).toBe(false);
  expect(registry.requestClose(["a"])).toBe(true);
  registry.dispose();
});

it("保存回执未到达前保留圆点，即使输入期间撤销到旧磁盘快照", () => {
  const registry = new DocumentEditorRegistry();
  const file = entry();
  let saving = true;
  registry.register("a", { ...file, isSaving: () => saving });
  file.change(false);
  expect(registry.isDirty("a")).toBe(true);
  saving = false;
  file.change(false);
  expect(registry.isDirty("a")).toBe(false);
  registry.dispose();
});
