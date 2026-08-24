import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AccessControlledContent,
  createAppQueryClient,
  navigateToTaskFromNotification,
} from "./providers.js";
import { router } from "./router.js";

describe("createAppQueryClient", () => {
  it("uses stable defaults for a local long-running project", () => {
    const queryClient = createAppQueryClient();
    const queryDefaults = queryClient.getDefaultOptions().queries;

    expect(queryDefaults?.gcTime).toBe(120_000);
    expect(queryDefaults?.retry).toBe(1);
    expect(queryDefaults?.staleTime).toBe(30_000);
    expect(queryDefaults?.refetchOnWindowFocus).toBe(false);
    expect(queryClient.getMutationCache()).toBeDefined();
  });

  it("routes notification clicks inside the current application", () => {
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue();

    navigateToTaskFromNotification("project / 1", "task / 1");

    expect(navigate).toHaveBeenCalledWith({
      params: { projectId: "project / 1", taskId: "task / 1" },
      to: "/p/$projectId/t/$taskId",
    });
    navigate.mockRestore();
  });

  it("routes temporary notification clicks without a Project parameter", () => {
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue();

    navigateToTaskFromNotification("temporary", "task / 1");

    expect(navigate).toHaveBeenCalledWith({
      params: { taskId: "task / 1" },
      to: "/temporary/t/$taskId",
    });
    navigate.mockRestore();
  });

  it("does not render the business provider subtree before authentication", () => {
    const unauthenticated = renderToStaticMarkup(
      <AccessControlledContent
        access={{
          error: null,
          loading: false,
          logout: vi.fn(),
          pair: vi.fn(),
          pairing: false,
          retry: vi.fn(),
          status: { authenticated: false, mode: "lan", version: 1 },
        }}
      >
        <div>secret-workbench</div>
      </AccessControlledContent>,
    );
    const authenticated = renderToStaticMarkup(
      <AccessControlledContent
        access={{
          error: null,
          loading: false,
          logout: vi.fn(),
          pair: vi.fn(),
          pairing: false,
          retry: vi.fn(),
          status: { authenticated: true, mode: "local", version: 1 },
        }}
      >
        <div>secret-workbench</div>
      </AccessControlledContent>,
    );

    expect(unauthenticated).not.toContain("secret-workbench");
    expect(authenticated).toContain("secret-workbench");
  });
});
