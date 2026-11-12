import { expect, it, vi } from "vitest";
import { backgroundTerminalQuery } from "./background-terminal-query.js";

it.each(["pending", "acp"] as const)("%s 手动查询不回退，旧终端缓存不启动轮询", (runtime) => {
  const client = { listBackgroundTerminals: vi.fn() };
  const options = backgroundTerminalQuery("p", "t", client, true, true, runtime);
  expect(options.enabled).toBe(false);
  expect(() => options.queryFn({ signal: new AbortController().signal })).toThrow();
  expect(options.refetchInterval({ state: { data: { data: [{ id: "cached" }] as never } } })).toBe(
    false,
  );
  expect(options.queryKey).not.toEqual(
    backgroundTerminalQuery("p", "t", client, true, true, "legacy").queryKey,
  );
  expect(client.listBackgroundTerminals).not.toHaveBeenCalled();
});

it("旧查询保留 signal 和轮询预算，关闭右栏不轮询", async () => {
  const client = { listBackgroundTerminals: vi.fn(() => Promise.resolve({ data: [] })) };
  const signal = new AbortController().signal;
  const options = backgroundTerminalQuery("p", "t", client, true, true, "legacy");
  expect(await options.queryFn({ signal })).toEqual({ data: [] });
  expect(client.listBackgroundTerminals).toHaveBeenCalledWith("p", "t", { signal });
  expect(options.refetchInterval({ state: { data: { data: [] } } })).toBe(10000);
  expect(options.refetchInterval({ state: { data: { data: [{ id: "live" }] as never } } })).toBe(
    1500,
  );
  expect(
    backgroundTerminalQuery("p", "t", client, true, false, "legacy").refetchInterval({
      state: { data: undefined },
    }),
  ).toBe(false);
});
