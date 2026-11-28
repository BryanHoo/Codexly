import * as undici from "#undici";

type FetchDispatcher = NonNullable<RequestInit["dispatcher"]>;
let pool: undici.Agent | undefined;
let nodeDispatcher: FetchDispatcher | undefined;

// 统一 Node 和 npm 版 Undici 在 Fetch 标准类型上的声明差异。
const fetchWithUndici = undici.fetch as unknown as (
  input: string | URL,
  init: Omit<RequestInit, "dispatcher"> & { dispatcher: undici.Agent },
) => Promise<Response>;

/** 应用出站请求共用直连连接池，不修改宿主的环境变量或全局 fetch。 */
export function fetchDirect(input: string | URL, init?: RequestInit): Promise<Response> {
  pool ??= new undici.Agent();
  if (process.versions["bun"]) {
    // Bun 1.4.2 的内置 fetch 会读取代理环境。显式加载 npm 版 Undici 并使用直连池。
    return fetchWithUndici(input, { ...init, dispatcher: pool });
  }
  // Node 内置 fetch 使用旧版回调接口，由 Undici 的兼容包装器转接到直连池。
  nodeDispatcher ??= new undici.Dispatcher1Wrapper(pool) as unknown as FetchDispatcher;
  return fetch(input, { ...init, dispatcher: nodeDispatcher });
}
