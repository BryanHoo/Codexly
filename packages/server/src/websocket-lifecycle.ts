import type { WebSocket } from "ws";

export const WEBSOCKET_HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface Connection {
  alive: boolean;
  terminate: () => void;
}

/** 每个服务实例共用一个心跳定时器，统一释放事件连接的订阅与活跃计数。 */
export class WebSocketLifecycle {
  readonly #connections = new Map<WebSocket, Connection>();
  #timer: ReturnType<typeof setInterval> | undefined;
  #closed = false;

  public track(socket: WebSocket, onCleanup: () => void): () => void {
    let cleanedUp = false;
    const onPong = () => {
      connection.alive = true;
    };
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      socket.off("pong", onPong);
      this.#connections.delete(socket);
      if (this.#connections.size === 0 && this.#timer !== undefined) {
        clearInterval(this.#timer);
        this.#timer = undefined;
      }
      onCleanup();
    };
    const terminate = () => {
      // 不等待 TCP 或 close 事件；半开连接必须立即解除订阅，才能恢复项目空闲回收。
      cleanup();
      socket.terminate();
    };
    const connection: Connection = { alive: true, terminate };
    socket.once("close", cleanup);
    socket.once("error", terminate);
    socket.on("pong", onPong);
    if (this.#closed || socket.readyState !== socket.OPEN) {
      terminate();
      return cleanup;
    }
    this.#connections.set(socket, connection);
    if (this.#timer === undefined) {
      this.#timer = setInterval(() => {
        for (const [client, state] of this.#connections) {
          // 每轮 ping 留出完整的 30 秒 pong 窗口；失联或正在关闭的连接不再保活。
          if (!state.alive || client.readyState !== client.OPEN) {
            state.terminate();
            continue;
          }
          state.alive = false;
          try {
            client.ping(undefined, undefined, (error?: Error) => {
              if (error !== undefined) state.terminate();
            });
          } catch {
            // 写入失败只终止当前连接，不能打断同一轮其他连接的心跳检测。
            state.terminate();
          }
        }
      }, WEBSOCKET_HEARTBEAT_INTERVAL_MS);
      this.#timer.unref();
    }
    return cleanup;
  }

  public close(): void {
    this.#closed = true;
    for (const connection of this.#connections.values()) {
      connection.terminate();
    }
  }
}

export function scheduleSessionExpiry(socket: WebSocket, expiresAt: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expire = () => {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      socket.close(1008, "Access session expired");
      return;
    }
    // Node 定时器有 32 位延迟上限，长会话分段等待但仍使用固定绝对期限。
    timer = setTimeout(expire, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
    timer.unref();
  };
  expire();
  return () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}
