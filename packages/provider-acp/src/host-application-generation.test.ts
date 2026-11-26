import { expect, it, vi } from "vitest";
import { applicationPreferencesFromLegacy } from "@codexly/core";
import { dispatchAcpHost } from "./host-dispatch.js";

it("辅助生成仅消费可信范围和严格请求，不订阅用户会话或创建任务 Provider", async () => {
  const generateText = vi.fn().mockResolvedValue('{"message":"改写结果"}');
  const forScope = vi.fn(() => {
    throw new Error("不能构造用户任务");
  });
  const subscribe = vi.fn(),
    snapshot = vi.fn();
  const scope = {
    id: "p",
    kind: "project",
    rootPath: "/trusted",
    runtimeWorkspaceRoots: ["/trusted"],
  };
  const preferences = applicationPreferencesFromLegacy({
    defaultAgent: "claude",
    defaultModel: null,
  });
  const params = { preferences, request: { purpose: "optimize", text: "input" } };
  const dispatch = (input: object, trusted: unknown = scope) =>
    dispatchAcpHost(
      { generateText, forScope } as never,
      { method: "application.generate", scope: trusted, params: input },
      subscribe,
      new AbortController().signal,
      snapshot,
      {} as never,
    );
  expect(await dispatch(params)).toBe("改写结果");
  expect(generateText).toHaveBeenCalledWith(
    "claude",
    "/trusted",
    expect.any(String),
    undefined,
    expect.any(AbortSignal),
  );
  for (const invalid of [
    { ...params, cwd: "/secret" },
    { ...params, request: { ...params.request, model: "override" } },
    { ...params, preferences: { ...preferences, unknown: 1 } },
  ])
    await expect(dispatch(invalid)).rejects.toThrow();
  await expect(dispatch(params, null)).rejects.toThrow();
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(forScope).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  expect(snapshot).not.toHaveBeenCalled();
});
