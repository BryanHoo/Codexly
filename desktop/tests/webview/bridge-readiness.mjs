const delay = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export async function waitForWebviewBridge(
  probe,
  { intervalMs = 100, timeoutMs = 10_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let firstAttempt = true;
  let lastError;

  while (firstAttempt || Date.now() < deadline) {
    firstAttempt = false;
    try {
      await probe();
      return;
    } catch (error) {
      lastError = error;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await delay(Math.min(intervalMs, remainingMs));
  }

  throw lastError ?? new Error("WebView test bridge did not become ready");
}
