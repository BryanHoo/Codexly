import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
import { TauriCatalogClient } from "./catalog-client.js";
it("原生监听按客户端共享，异步注册完成后才校准，取消不启动旧运行时", async () => {
  let finish!: (stop: () => void) => void;
  const stop = vi.fn();
  let deliver!: (event: { payload: unknown }) => void;
  mocks.listen.mockImplementationOnce((_name, listener) => {
    deliver = listener;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const ensureRuntime = vi.fn();
  const client = new TauriCatalogClient({ ensureRuntime });
  const a = vi.fn(),
    b = vi.fn();
  const stopA = client.subscribeAcpPlans(a),
    stopB = client.subscribeAcpPlans(b);
  await vi.waitFor(() =>
    expect(mocks.listen).toHaveBeenCalledExactlyOnceWith(
      "acp-plan://changed",
      expect.any(Function),
    ),
  );
  finish(stop);
  await vi.waitFor(() => expect(a).toHaveBeenCalledOnce());
  expect(b).toHaveBeenCalledOnce();
  deliver({ payload: { type: "acp-plans.changed" } });
  expect(a).toHaveBeenCalledTimes(2);
  expect(b).toHaveBeenCalledTimes(2);
  stopA();
  deliver({ payload: { type: "acp-plans.changed" } });
  expect(a).toHaveBeenCalledTimes(2);
  stopB();
  expect(stop).toHaveBeenCalledOnce();
  deliver({ payload: { type: "acp-plans.changed" } });
  expect(b).toHaveBeenCalledTimes(3);
  expect(ensureRuntime).not.toHaveBeenCalled();
});
it("注册完成前卸载会在完成后释放，迟到事件不能通知后来的订阅", async () => {
  mocks.listen.mockReset();
  let finish!: (stop: () => void) => void;
  const stop = vi.fn();
  mocks.listen.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const client = new TauriCatalogClient();
  const changed = vi.fn();
  const unsubscribe = client.subscribeAcpPlans(changed);
  await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());
  unsubscribe();
  finish(stop);
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  expect(changed).not.toHaveBeenCalled();
});
