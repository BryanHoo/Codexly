interface ListenableServer {
  listen(options: { host: string; port: number }): Promise<string>;
}

const MAX_TCP_PORT = 65_535;

function isAddressInUseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
  );
}

export async function listenOnAvailablePort(
  server: ListenableServer,
  host: string,
  initialPort: number,
): Promise<number> {
  // 直接尝试监听可避免“先探测、后监听”之间被其他进程抢占端口的竞态。
  for (let port = initialPort; port <= MAX_TCP_PORT; port += 1) {
    try {
      await server.listen({ host, port });
      return port;
    } catch (error) {
      if (!isAddressInUseError(error) || port === MAX_TCP_PORT) {
        throw error;
      }
    }
  }

  throw new Error(`端口 ${String(initialPort)} 到 ${String(MAX_TCP_PORT)} 均不可用`);
}
