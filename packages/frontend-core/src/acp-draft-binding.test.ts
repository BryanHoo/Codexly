import { expect, it, vi } from "vitest";
import { bindAcpDraft } from "./acp-draft-binding.js";
import type { AcpConfigPreview, AcpConfigPreviewRequest } from "@codexly/protocol";

const preview: AcpConfigPreview = {
  values: { enabled: false },
  configOptions: [{ id: "enabled", name: "开关", type: "boolean", currentValue: false }],
};
it("预览失败后显式重试，恢复成功前不能发送", async () => {
  const f = fixture();
  f.read.mockRejectedValueOnce(new Error("认证暂时不可用"));
  const binding = f.create();
  await vi.waitFor(() => {
    expect(binding.getSnapshot().isPending).toBe(false);
  });
  expect(binding.getSnapshot().error?.message).toBe("认证暂时不可用");
  expect(await binding.reload()).toBe(true);
  expect(binding.getSnapshot().error).toBeNull();
  binding.dispose();
});
function fixture() {
  let persisted: unknown;
  const save = vi.fn((value: unknown) => {
    persisted = value;
  });
  const read = vi.fn((_input: AcpConfigPreviewRequest, _signal: AbortSignal) =>
    Promise.resolve(preview),
  );
  const change = vi.fn();
  let count = 0;
  const create = () =>
    bindAcpDraft({
      restored: persisted,
      preview: read,
      save,
      onChange: change,
      createKey: () => `next-${String(++count)}`,
    });
  return { create, save, read, change };
}
it("首次协商之前禁止发送，单项变化与发送共用同步锁且保留 false", async () => {
  const f = fixture();
  let resolve!: (value: AcpConfigPreview) => void;
  f.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const binding = f.create();
  const send = vi.fn(() => Promise.resolve("ok"));
  await expect(binding.submit({ text: "草稿" }, "first", send)).rejects.toThrow();
  resolve(preview);
  await vi.waitFor(() => {
    expect(binding.getSnapshot().isPending).toBe(false);
  });
  f.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const setting = binding.setConfig("enabled", true);
  await expect(binding.submit({ text: "草稿" }, "first", send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  resolve({ ...preview, values: { enabled: true } });
  await setting;
  await binding.submit({ text: "草稿" }, "first", send);
  expect(send).toHaveBeenCalledWith({
    values: { enabled: true },
    key: "first",
    creationKey: "first",
  });
  binding.dispose();
});
it("失败后重挂载复用原请求身份，配置改变后通过新键转交原任务", async () => {
  const f = fixture();
  let binding = f.create();
  await vi.waitFor(() => {
    expect(binding.getSnapshot().isPending).toBe(false);
  });
  const send = vi.fn().mockRejectedValue(new Error("未提交"));
  await expect(binding.submit({ text: "草稿" }, "first", send)).rejects.toThrow("未提交");
  binding.dispose();
  binding = f.create();
  await vi.waitFor(() => {
    expect(binding.getSnapshot().isPending).toBe(false);
  });
  await expect(binding.submit({ text: "草稿" }, "ignored", send)).rejects.toThrow();
  expect(send).toHaveBeenLastCalledWith({
    values: { enabled: false },
    key: "first",
    creationKey: "first",
  });
  f.read.mockResolvedValueOnce({ ...preview, values: { enabled: true } });
  await binding.setConfig("enabled", true);
  await expect(binding.submit({ text: "草稿" }, "ignored", send)).rejects.toThrow();
  expect(send).toHaveBeenLastCalledWith({
    values: { enabled: true },
    key: "next-1",
    creationKey: "first",
    recoveryKey: "first",
  });
  // 新请求失败后保留相同转交链，不能每次点击又生成一个键。
  await expect(binding.submit({ text: "草稿" }, "ignored", send)).rejects.toThrow();
  expect(send).toHaveBeenLastCalledWith({
    values: { enabled: true },
    key: "next-1",
    creationKey: "first",
    recoveryKey: "first",
  });
  binding.dispose();
});
it("保存失败不发送，卸载取消预览并丢弃迟到配置", async () => {
  const f = fixture();
  const binding = f.create();
  await vi.waitFor(() => {
    expect(binding.getSnapshot().isPending).toBe(false);
  });
  f.save.mockImplementationOnce(() => {
    throw new Error("无法保留提交身份");
  });
  const send = vi.fn();
  await expect(binding.submit({ text: "a" }, "k", send)).rejects.toThrow("无法保留提交身份");
  expect(send).not.toHaveBeenCalled();
  let resolve!: (value: AcpConfigPreview) => void;
  f.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = binding.setConfig("enabled", true);
  const signal = f.read.mock.calls.at(-1)?.[1];
  binding.dispose();
  const calls = f.save.mock.calls.length;
  resolve({ ...preview, values: { enabled: true } });
  await pending;
  expect(signal?.aborted).toBe(true);
  expect(f.save).toHaveBeenCalledTimes(calls);
});
it("已卸载草稿的发送回执不能删除后来窗口的恢复记录", async () => {
  const f = fixture();
  const binding = f.create();
  await vi.waitFor(() => {
    expect(binding.getSnapshot().isPending).toBe(false);
  });
  let resolve!: (result: string) => void;
  const send = binding.submit(
    { text: "a" },
    "k",
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  binding.dispose();
  const saves = f.save.mock.calls.length;
  resolve("ok");
  await send;
  expect(f.save).toHaveBeenCalledTimes(saves);
});
it("已有提交的草稿不能换引擎或目录重新协商，损坏身份也不能被默默重置", async () => {
  const f = fixture();
  const original = f.create();
  await vi.waitFor(() => {
    expect(original.getSnapshot().isPending).toBe(false);
  });
  await expect(
    original.submit({ text: "a" }, "k", () => Promise.reject(new Error("未知结果"))),
  ).rejects.toThrow();
  original.dispose();
  const persisted = f.save.mock.calls.at(-1)?.[0];
  const preview = vi.fn();
  for (const restored of [
    persisted,
    { version: 1, identity: "other", values: {}, attempt: { key: 1 } },
    { version: 1, identity: "other", values: {}, attempt: false },
    { version: 1, identity: "other", values: {}, attempt: null },
  ]) {
    const binding = bindAcpDraft({
      identity: "other",
      restored,
      preview,
      save: vi.fn(),
      onChange: vi.fn(),
      createKey: () => "unused",
    });
    expect(binding.getSnapshot().error).not.toBeNull();
    expect(await binding.reload()).toBe(false);
    expect(preview).not.toHaveBeenCalled();
    binding.dispose();
  }
});
