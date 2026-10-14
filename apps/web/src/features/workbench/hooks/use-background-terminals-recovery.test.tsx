import type * as ReactQuery from "@tanstack/react-query";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBackgroundTerminals } from "./use-background-terminals.js";

const captured = vi.hoisted(() => ({
  queryOptions: {} as Record<string, unknown>,
  refetch: vi.fn().mockResolvedValue({ data: { data: [] } }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactQuery>();
  return {
    ...actual,
    useQuery: (options: Record<string, unknown>) => {
      captured.queryOptions = options;
      return { data: { data: [] }, error: null, isPending: false, refetch: captured.refetch };
    },
    useQueryClient: () => ({ setQueryData: vi.fn() }),
    useMutation: (options: {
      mutationFn: (id: string) => Promise<unknown>;
      onSuccess?: (response: unknown) => void;
    }) => ({
      mutateAsync: async (id: string) => {
        const response = await options.mutationFn(id);
        options.onSuccess?.(response);
        return response;
      },
    }),
  };
});

afterEach(() => vi.clearAllMocks());

function renderTerminals(client: Parameters<typeof useBackgroundTerminals>[0]) {
  const captureView = vi.fn<(view: ReturnType<typeof useBackgroundTerminals>) => void>();
  function Probe() {
    captureView(useBackgroundTerminals(client, "project-1", "task-1", false));
    return null;
  }
  renderToStaticMarkup(<Probe />);
  const view = captureView.mock.calls[0]?.[0];
  if (view === undefined) throw new Error("Terminal hook was not rendered");
  return view;
}

describe("background terminal recovery", () => {
  it("reads the live list when reopening a completed task with a fresh cached terminal", async () => {
    const client = {
      listBackgroundTerminals: vi.fn().mockResolvedValue({ data: [] }),
      terminateBackgroundTerminal: vi.fn(),
    };
    renderTerminals(client);
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    const queryKey = captured.queryOptions["queryKey"] as readonly unknown[];
    queryClient.setQueryData(queryKey, { data: [{ id: "exited-terminal" }] });
    const observer = new QueryObserver(queryClient, { ...captured.queryOptions, queryKey });
    const unsubscribe = observer.subscribe(vi.fn());
    try {
      await vi.waitFor(() => {
        expect(client.listBackgroundTerminals).toHaveBeenCalledOnce();
      });
      await vi.waitFor(() => {
        expect(queryClient.getQueryData(queryKey)).toEqual({ data: [] });
      });
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });

  it("refreshes the authoritative list after termination fails", async () => {
    const client = {
      listBackgroundTerminals: vi.fn(),
      terminateBackgroundTerminal: vi.fn().mockRejectedValue(new Error("Process is gone")),
    };
    await renderTerminals(client).terminateTerminal("exited-terminal");
    expect(captured.refetch).toHaveBeenCalledOnce();
  });
});
