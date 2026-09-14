export function createProcessShutdownSignal(): { cleanup: () => void; signal: AbortSignal } {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  return {
    cleanup: () => {
      process.off("SIGINT", abort);
      process.off("SIGTERM", abort);
    },
    signal: controller.signal,
  };
}

export async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true },
    );
  });
}
