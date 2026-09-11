import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScheduledTasksContainer } from "./scheduled-tasks-container.js";

const { useQuery } = vi.hoisted(() => ({
  useQuery: vi.fn((_options: unknown) => ({ data: undefined })),
}));
vi.mock("@tanstack/react-query", () => ({
  queryOptions: (options: unknown) => options,
  useQuery,
  useQueryClient: () => ({}),
  useMutation: () => ({}),
}));
vi.mock("./components/scheduled-task-editor.js", () => ({ ScheduledTaskEditor: () => null }));
vi.mock("./components/scheduled-task-list.js", () => ({ ScheduledTaskList: () => null }));

describe("scheduled task automatic refresh", () => {
  it("uses the shared query without a second polling timer", () => {
    const context = {
      modelsQuery: {},
      skillsQuery: {},
      t: () => "",
      client: {},
    } as unknown as ComponentProps<typeof ScheduledTasksContainer>["context"];
    renderToStaticMarkup(
      <ScheduledTasksContainer context={context} projectId="temporary" temporary />,
    );
    const options = useQuery.mock.calls[0]?.[0] as {
      refetchInterval: (query: unknown) => number | false;
    };
    expect(options.refetchInterval).toBeUndefined();
  });
});
