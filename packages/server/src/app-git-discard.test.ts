import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  encodedProjectRootPath,
  projectRootPath,
} from "./app-all.test-support.js";
import { discardSelectedProjectChanges } from "./git-discard.js";
vi.mock("./git-discard.js", () => ({ discardSelectedProjectChanges: vi.fn() }));
const status = {
  baseBranches: [],
  branches: [],
  branch: "main",
  repositoryMode: "root" as const,
  snapshot: "b".repeat(64),
  staged: [],
  unstaged: [],
};
it("discards with root authorization and idempotency and validates the selection schema", async () => {
  const { provider } = createProvider();
  const app = await createCodexlyServer(createServerOptions(provider));
  closeCallbacks.push(() => app.close());
  vi.mocked(discardSelectedProjectChanges).mockResolvedValue(status);
  const payload = { paths: ["a.txt"], expectedSnapshot: "a".repeat(64) };
  const options = {
    method: "POST" as const,
    url: `/v1/projects/codexly/git/discard?rootPath=${encodedProjectRootPath}`,
    headers: { "idempotency-key": "discard-once" },
    payload,
  };
  expect((await app.inject(options)).json()).toEqual(status);
  expect((await app.inject(options)).json()).toEqual(status);
  expect(discardSelectedProjectChanges).toHaveBeenCalledExactlyOnceWith(projectRootPath, payload);
  for (const paths of [[], ["../outside"], ["a.txt", "a.txt"]])
    expect(
      (
        await app.inject({
          ...options,
          headers: { "idempotency-key": JSON.stringify(paths) },
          payload: { ...payload, paths },
        })
      ).statusCode,
    ).toBe(400);
  const wrongRoot = await app.inject({
    ...options,
    url: "/v1/projects/codexly/git/discard?rootPath=%2Foutside",
  });
  expect(wrongRoot.statusCode).toBe(400);
});
it("shares the Git mutation guard with push and releases it after failure", async () => {
  const { provider } = createProvider();
  const app = await createCodexlyServer(createServerOptions(provider));
  closeCallbacks.push(() => app.close());
  let fail!: (error: Error) => void;
  vi.mocked(discardSelectedProjectChanges).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const options = {
    method: "POST" as const,
    url: `/v1/projects/codexly/git/discard?rootPath=${encodedProjectRootPath}`,
    headers: { "idempotency-key": "discard-pending" },
    payload: { paths: ["a.txt"], expectedSnapshot: "a".repeat(64) },
  };
  const pending = app.inject(options);
  await vi.waitFor(() => {
    expect(fail).toBeTypeOf("function");
  });
  const overlap = await app.inject({
    ...options,
    url: `/v1/projects/codexly/git/push?rootPath=${encodedProjectRootPath}`,
    headers: { "idempotency-key": "push-overlap" },
    payload: { expectedSnapshot: "a".repeat(64) },
  });
  expect(overlap.statusCode).toBe(409);
  expect(overlap.json()).toMatchObject({ code: "GIT_MUTATION_IN_PROGRESS" });
  fail(new Error("failed"));
  expect((await pending).statusCode).toBe(502);
  vi.mocked(discardSelectedProjectChanges).mockResolvedValueOnce(status);
  expect(
    (await app.inject({ ...options, headers: { "idempotency-key": "discard-retry" } })).statusCode,
  ).toBe(200);
});
