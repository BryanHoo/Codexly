import { expect, it, vi } from "vitest";
import { dispatchAcpHost } from "./host-dispatch.js";
it("宿主预览只使用可信 scope，不构造任务 Provider，拒绝额外路径", async () => {
  const previewConfig = vi.fn(() =>
    Promise.resolve({ configOptions: [], values: { enabled: false } }),
  );
  const forScope = vi.fn(() => {
    throw new Error("不能创建任务 Provider");
  });
  const runtime = { agents: { claude: { previewConfig } }, forScope };
  const controller = new AbortController();
  const scope = {
    id: "p",
    kind: "project",
    rootPath: "/trusted",
    runtimeWorkspaceRoots: ["/trusted"],
  };
  const dispatch = (params: object) =>
    dispatchAcpHost(
      runtime as never,
      { method: "settings.preview", scope, params },
      vi.fn(),
      controller.signal,
      vi.fn(),
      {} as never,
    );
  await expect(dispatch({ engine: "claude", values: { enabled: false } })).resolves.toEqual({
    configOptions: [],
    values: { enabled: false },
  });
  expect(previewConfig).toHaveBeenCalledWith(
    "/trusted",
    { values: { enabled: false } },
    controller.signal,
  );
  await expect(dispatch({ engine: "claude", values: {}, cwd: "/secret" })).rejects.toThrow();
  expect(forScope).not.toHaveBeenCalled();
  expect(previewConfig).toHaveBeenCalledTimes(1);
});
