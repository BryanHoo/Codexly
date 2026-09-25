import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useProjectGitStatusRouteRefresh } from "./use-project-git-status-route-refresh.js";

type HarnessProps = Readonly<{
  isPending: boolean;
  refetch: () => Promise<unknown>;
  routeScope: string;
}>;

function Harness({ isPending, refetch, routeScope }: HarnessProps) {
  useProjectGitStatusRouteRefresh(routeScope, true, { isPending, refetch });
  return null;
}

test("switching away from and back to a task refreshes the project Git status", async () => {
  const refetch = vi.fn(async () => undefined);
  const screen = await render(
    <Harness isPending refetch={refetch} routeScope="project-a:task-a:/repo" />,
  );

  await screen.rerender(
    <Harness isPending={false} refetch={refetch} routeScope="project-a:task-a:/repo" />,
  );
  expect(refetch).not.toHaveBeenCalled();

  await screen.rerender(
    <Harness isPending={false} refetch={refetch} routeScope="project-a:task-b:/repo" />,
  );
  await vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));

  await screen.rerender(
    <Harness isPending={false} refetch={refetch} routeScope="project-a:task-a:/repo" />,
  );
  await vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(2));
});
