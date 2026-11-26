import { StrictMode, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AcpConfigOptions } from "@codexly/ui/core/acp-config-options";
import { useAcpSession, type AcpSessionClient } from "@codexly/ui/core/use-acp-session";
import type { AcpSessionSource } from "@codexly/frontend-core/acp-session-binding";
import type { AcpSessionState } from "@codexly/protocol";
import { CodexlyClient } from "../../../packages/client/src/http-client.js";
import { TauriSidebarClient } from "../../src/platform/tauri/sidebar-client.js";
import type { InvokeImplementation } from "../../src/platform/tauri/native-client.js";
import { createTaskStore as createWebStore } from "../../../apps/web/src/features/conversation/runtime/task-store.js";
import { createTaskStore as createDesktopStore } from "../../src/features/conversation/runtime/task-store.js";
import {
  createResponse,
  eventEnvelope,
} from "../../../apps/web/src/features/conversation/runtime/task-store.test-support.js";

const initial: AcpSessionState = {
  configOptions: [
    {
      id: "model-id",
      name: "Agent 模型",
      type: "select",
      currentValue: "one",
      options: [
        {
          group: "native",
          name: "原生分组",
          options: [
            { value: "one", name: "模型一" },
            { value: "two", name: "模型二" },
          ],
        },
      ],
    },
    { id: "thinking-id", name: "Agent 思考", type: "boolean", currentValue: false },
  ],
  availableCommands: [{ name: "review", description: "检查" }],
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span>{label}</span>
      {children}
    </div>
  );
}
function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}
function Harness({
  source,
  client,
  taskId = "task-1",
}: {
  source?: AcpSessionSource;
  client: AcpSessionClient;
  taskId?: string;
}) {
  const state = useAcpSession({
    client,
    projectId: "project-1",
    taskId,
    ...(source ? { source } : {}),
  });
  const [draft, setDraft] = useState("尚未发送的草稿");
  return (
    <>
      <textarea
        aria-label="草稿"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <AcpConfigOptions
        options={state.session?.configOptions ?? []}
        Field={Field}
        Select={Select}
        disabled={state.isPending || state.isSaving}
        onChange={(id, value) => {
          void state.setConfig(id, value);
        }}
      />
      <output aria-label="命令">
        {state.session?.availableCommands.map((command) => command.name).join(",")}
      </output>
      <output aria-label="错误">{state.error?.message}</output>
    </>
  );
}

for (const [platform, createStore] of [
  ["web", createWebStore],
  ["desktop", createDesktopStore],
] as const) {
  it(`${platform}：ACP 模型响应完整替换配置且保留草稿，布尔 false 正确呈现`, async () => {
    const store = createStore({ projectId: "project-1", taskId: "task-1" });
    store.getState().hydrate(createResponse({ acpSession: initial }));
    let resolve!: (value: AcpSessionState["configOptions"]) => void;
    const client = {
      getAcpSessionState: vi.fn(),
      setAcpSessionConfig: vi.fn(
        () =>
          new Promise<AcpSessionState["configOptions"]>((done) => {
            resolve = done;
          }),
      ),
    };
    const screen = await render(
      <StrictMode>
        <Harness source={store} client={client} />
      </StrictMode>,
    );
    await expect.element(screen.getByRole("checkbox", { name: "Agent 思考" })).not.toBeChecked();
    expect(client.getAcpSessionState).not.toHaveBeenCalled();
    await screen.getByRole("combobox", { name: "Agent 模型" }).selectOptions("two");
    await expect.element(screen.getByRole("combobox")).toBeDisabled();
    expect(client.setAcpSessionConfig).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      "model-id",
      "two",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    resolve([{ ...initial.configOptions[0]!, currentValue: "two" }]);
    await expect.element(screen.getByRole("combobox")).toHaveValue("two");
    await expect.element(screen.getByRole("checkbox")).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("textbox", { name: "草稿" }))
      .toHaveValue("尚未发送的草稿");
    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        projectId: "project-1",
        type: "acp.session.updated",
        payload: { state: { configOptions: [], availableCommands: [] } },
      },
    ]);
    await expect.element(screen.getByRole("status", { name: "命令" })).toBeEmptyDOMElement();
    await expect.element(screen.getByRole("combobox")).not.toBeInTheDocument();
    await screen.unmount();
  });
}

it("切换任务中止旧请求，迟到响应和卸载后写入不能污染新会话", async () => {
  const pending: Array<(value: AcpSessionState) => void> = [],
    signals: AbortSignal[] = [];
  const client: AcpSessionClient = {
    getAcpSessionState: vi.fn((_project, _task, options) => {
      signals.push(options.signal);
      return new Promise((resolve) => {
        pending.push(resolve);
      });
    }),
    setAcpSessionConfig: vi.fn(),
  };
  const screen = await render(<Harness client={client} />);
  await screen.rerender(<Harness client={client} taskId="other" />);
  expect(signals[0]?.aborted).toBe(true);
  pending[1]!({ configOptions: [], availableCommands: [{ name: "new", description: "新命令" }] });
  pending[0]!(initial);
  await expect.element(screen.getByRole("status", { name: "命令" })).toHaveTextContent("new");
  await expect.element(screen.getByRole("combobox")).not.toBeInTheDocument();
  await screen.unmount();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

for (const platform of ["web", "desktop"] as const) {
  it(`${platform}：共享配置 Hook 经真实客户端完成读取与布尔写入`, async () => {
    const changed: AcpSessionState["configOptions"] = [
      { id: "thinking-id", name: "Agent 思考", type: "boolean", currentValue: true },
    ];
    const fetch = vi.fn<typeof globalThis.fetch>((_url, options) =>
      Promise.resolve(new Response(JSON.stringify(options?.method === "PUT" ? changed : initial))),
    );
    const invoke = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command !== "acp_task_request") throw new Error("配置不得调用旧引擎命令");
      return Promise.resolve(args?.["method"] === "session.config.write" ? changed : initial);
    });
    const ensureRuntime = vi.fn();
    const client =
      platform === "web"
        ? new CodexlyClient({ baseUrl: "https://acp.test", fetch })
        : new TauriSidebarClient({
            invoke: invoke as InvokeImplementation,
            ensureRuntime,
            connectEvents: () => Promise.resolve(),
          });
    const screen = await render(<Harness client={client} />);
    const checkbox = screen.getByRole("checkbox", { name: "Agent 思考" });
    await expect.element(checkbox).not.toBeChecked();
    await checkbox.click();
    await expect.element(checkbox).toBeChecked();
    await expect.element(screen.getByRole("combobox")).not.toBeInTheDocument();
    const verifyWeb = () => {
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        "https://acp.test/v1/projects/project-1/tasks/task-1/acp/session",
        "https://acp.test/v1/projects/project-1/tasks/task-1/acp/config",
      ]);
      expect(fetch.mock.calls[1]?.[1]).toMatchObject({
        method: "PUT",
        body: '{"configId":"thinking-id","value":true}',
      });
    };
    const verifyDesktop = () => {
      expect(invoke).toHaveBeenLastCalledWith("acp_task_request", {
        projectId: "project-1",
        method: "session.config.write",
        params: { taskId: "task-1", configId: "thinking-id", value: true },
      });
      expect(ensureRuntime).not.toHaveBeenCalled();
    };
    (platform === "web" ? verifyWeb : verifyDesktop)();
    await screen.unmount();
  });
}
