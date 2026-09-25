import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { CodexRuntimeGate } from "./codex-runtime-gate.js";

const runtimeMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  download: vi.fn(),
  inspect: vi.fn(),
}));

vi.mock("../../../platform/tauri/runtime.js", () => ({
  connectCodexRuntime: runtimeMocks.connect,
}));

vi.mock("../../../platform/tauri/codex-runtime-manager.js", () => ({
  downloadAndInspectCodexRuntime: runtimeMocks.download,
  inspectCodexRuntime: runtimeMocks.inspect,
}));

describe("CodexRuntimeGate", () => {
  beforeEach(() => {
    runtimeMocks.connect.mockReset().mockResolvedValue({ status: "idle", lastSeq: 0, provider: null });
    runtimeMocks.download.mockReset();
    runtimeMocks.inspect.mockReset();
  });

  it("restores the workbench without inspecting a runtime that stayed ready in the background", async () => {
    runtimeMocks.connect.mockResolvedValue({ status: "ready", lastSeq: 8, provider: "codex" });
    runtimeMocks.inspect.mockResolvedValue({
      detectedVersion: "0.156.0",
      requiredVersion: "0.156.0",
      status: "compatible",
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <CodexRuntimeGate><p>Workbench</p></CodexRuntimeGate>
      </QueryClientProvider>,
    );

    await expect.element(screen.getByText("Workbench")).toBeVisible();
    expect(runtimeMocks.inspect).not.toHaveBeenCalled();
  });

  it("does not show version detection while reconnecting to the background", async () => {
    runtimeMocks.connect.mockImplementation(() => new Promise(() => undefined));
    runtimeMocks.inspect.mockImplementation(() => new Promise(() => undefined));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <CodexRuntimeGate><p>Workbench</p></CodexRuntimeGate>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("status").query()).toBeNull();
  });

  it("shows staged progress while updating a managed runtime on startup", async () => {
    await i18n.changeLanguage("en");
    let reportProgress:
      | ((progress: {
          currentVersion: string;
          downloadedBytes: number;
          phase: string;
          sequence: number;
          targetVersion: string;
          totalBytes: number | null;
        }) => void)
      | undefined;
    runtimeMocks.inspect.mockImplementation(
      (onProgress: NonNullable<typeof reportProgress>) => {
        reportProgress = onProgress;
        return new Promise(() => undefined);
      },
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <CodexRuntimeGate>
            <p>Workbench</p>
          </CodexRuntimeGate>
        </QueryClientProvider>
      </I18nextProvider>,
    );

    await vi.waitFor(() => expect(reportProgress).toBeDefined());
    reportProgress?.({
      currentVersion: "0.150.0",
      downloadedBytes: 0,
      phase: "preparing",
      sequence: 1,
      targetVersion: "0.156.0",
      totalBytes: null,
    });

    await expect.element(screen.getByRole("heading", { name: "Updating Codex" })).toBeVisible();
    const progressbar = screen.getByRole("progressbar", { name: "Codex update progress" });
    expect(progressbar.element().firstElementChild).toBeNull();

    for (const [phase, downloadedBytes, totalBytes] of [
      ["downloading", 0, null],
      ["downloading", 0, 100],
      ["downloading", 42, null],
      ["installing", 42, null],
    ] as const) {
      flushSync(() => reportProgress?.({
        currentVersion: "0.150.0", downloadedBytes, phase,
        sequence: 2, targetVersion: "0.156.0", totalBytes,
      }));
      expect(progressbar.element().firstElementChild).toBeNull();
    }

    reportProgress?.({
      currentVersion: "0.150.0",
      downloadedBytes: 42,
      phase: "downloading",
      sequence: 2,
      targetVersion: "0.156.0",
      totalBytes: 100,
    });

    await expect.element(screen.getByText("0.150.0")).toBeVisible();
    await expect.element(screen.getByText("0.156.0")).toBeVisible();
    await expect
      .element(progressbar)
      .toHaveAttribute("aria-valuenow", "42");
    expect((progressbar.element().firstElementChild as HTMLElement).style.width).toBe("42%");
  });

  it("blocks the workbench after an automatic install fails and retries without global setup", async () => {
    await i18n.changeLanguage("en");
    runtimeMocks.inspect.mockImplementationOnce(async (onProgress) => {
      onProgress({ currentVersion: null, downloadedBytes: 0, phase: "failed",
        sequence: 2, targetVersion: "0.156.0", totalBytes: null });
      return { detectedVersion: null, requiredVersion: "0.156.0", status: "missing" };
    });
    runtimeMocks.download.mockResolvedValue({
      detectedVersion: "0.156.0", requiredVersion: "0.156.0", status: "compatible",
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <CodexRuntimeGate><p>Workbench</p></CodexRuntimeGate>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    await expect.element(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByText("Workbench", { exact: true }).query()).toBeNull();
    expect(screen.getByText("Install globally").query()).toBeNull();
    await screen.getByRole("button", { name: "Retry installation" }).click();
    await expect.element(screen.getByText("Workbench")).toBeVisible();
    expect(runtimeMocks.download).toHaveBeenCalledTimes(1);
  });

  it("automatically shows first-install progress and enters the workbench when ready", async () => {
    await i18n.changeLanguage("en");
    let finish: ((value: unknown) => void) | undefined;
    runtimeMocks.inspect.mockImplementation((onProgress) => {
      onProgress({ currentVersion: null, downloadedBytes: 10, phase: "downloading",
        sequence: 1, targetVersion: "0.156.0", totalBytes: 100 });
      return new Promise((resolve) => { finish = resolve; });
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <CodexRuntimeGate><p>Workbench</p></CodexRuntimeGate>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    await expect.element(screen.getByRole("heading", { name: "Installing Codex" })).toBeVisible();
    expect(runtimeMocks.download).not.toHaveBeenCalled();
    finish?.({ detectedVersion: "0.156.0", requiredVersion: "0.156.0", status: "compatible" });
    await expect.element(screen.getByText("Workbench")).toBeVisible();
  });

  it("shows live progress while downloading the private runtime", async () => {
    await i18n.changeLanguage("en");
    runtimeMocks.inspect.mockResolvedValue({
      detectedVersion: null,
      requiredVersion: "0.156.0",
      status: "missing",
    });
    let reportProgress:
      | ((progress: {
          currentVersion: string | null;
          downloadedBytes: number;
          phase: string;
          sequence: number;
          targetVersion: string;
          totalBytes: number | null;
        }) => void)
      | undefined;
    runtimeMocks.download.mockImplementation(
      (
        onProgress: (progress: {
          currentVersion: string | null;
          downloadedBytes: number;
          phase: string;
          sequence: number;
          targetVersion: string;
          totalBytes: number | null;
        }) => void,
      ) => {
        reportProgress = onProgress;
        return new Promise(() => undefined);
      },
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <CodexRuntimeGate>
            <p>Workbench</p>
          </CodexRuntimeGate>
        </QueryClientProvider>
      </I18nextProvider>,
    );

    await screen.getByRole("button", { name: "Retry installation" }).click();
    expect(reportProgress).toBeDefined();
    expect(screen.getByRole("progressbar", { name: "Download progress" }).query()).toBeNull();

    for (const totalBytes of [null, 100]) {
      flushSync(() => reportProgress?.({
        currentVersion: null, downloadedBytes: 0, phase: "downloading",
        sequence: 1, targetVersion: "0.156.0", totalBytes,
      }));
      const emptyBar = screen.getByRole("progressbar", { name: "Download progress" });
      await expect.element(emptyBar).toBeInTheDocument();
      expect(emptyBar.element().firstElementChild).toBeNull();
    }

    reportProgress?.({
      currentVersion: null,
      downloadedBytes: 42,
      phase: "downloading",
      sequence: 1,
      targetVersion: "0.156.0",
      totalBytes: 100,
    });

    const progressbar = screen.getByRole("progressbar", { name: "Download progress" });
    await expect.element(progressbar).toHaveAttribute("aria-valuenow", "42");
    await expect.element(screen.getByText("42%")).toBeVisible();
  });
});
