import type { AccessStatusResponse } from "@code-agent/protocol";
import type { QueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { CodeAgentAccessClient } from "../projects/project-queries.js";
import { notifyActionError, notifyActionSuccess } from "../notifications/action-notifications.js";

export type AccessError = "load" | null;

export type AccessState = Readonly<{
  error: AccessError;
  loading: boolean;
  pairing: boolean;
  status?: AccessStatusResponse;
}>;

export type AccessContextValue = AccessState &
  Readonly<{
    logout: () => Promise<void>;
    pair: (code: string) => Promise<void>;
    retry: () => void;
  }>;

const INITIAL_ACCESS_STATE: AccessState = {
  error: null,
  loading: true,
  pairing: false,
};

export class AccessSessionController {
  readonly #client: CodeAgentAccessClient;
  readonly #listeners = new Set<() => void>();
  readonly #queryClient: QueryClient;
  #generation = 0;
  #state: AccessState = INITIAL_ACCESS_STATE;
  #unsubscribeUnauthorized: (() => void) | undefined;

  public constructor(client: CodeAgentAccessClient, queryClient: QueryClient) {
    this.#client = client;
    this.#queryClient = queryClient;
  }

  public readonly getSnapshot = (): AccessState => this.#state;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  public start(): void {
    if (this.#unsubscribeUnauthorized !== undefined) {
      return;
    }
    this.#unsubscribeUnauthorized = this.#client.subscribeUnauthorized(() => {
      this.#generation += 1;
      this.#clearAuthenticatedState();
    });
    void this.load();
  }

  public stop(): void {
    this.#generation += 1;
    this.#unsubscribeUnauthorized?.();
    this.#unsubscribeUnauthorized = undefined;
  }

  public async load(): Promise<void> {
    const generation = (this.#generation += 1);
    this.#setState({ ...this.#state, error: null, loading: true });
    try {
      const status = await this.#client.getAccessStatus();
      if (generation === this.#generation) {
        this.#setState({ error: null, loading: false, pairing: false, status });
      }
    } catch {
      if (generation === this.#generation) {
        this.#setState({ ...this.#state, error: "load", loading: false });
      }
    }
  }

  public async pair(code: string): Promise<void> {
    this.#setState({ ...this.#state, error: null, pairing: true });
    try {
      const status = await this.#client.pairAccess(code);
      this.#setState({ error: null, loading: false, pairing: false, status });
      notifyActionSuccess();
    } catch (error) {
      this.#setState({ ...this.#state, error: null, pairing: false });
      notifyActionError(error);
    }
  }

  public async logout(): Promise<void> {
    try {
      const status = await this.#client.logoutAccess();
      this.#queryClient.clear();
      this.#setState({ error: null, loading: false, pairing: false, status });
      notifyActionSuccess();
    } catch (error) {
      notifyActionError(error);
      throw error;
    }
  }

  #clearAuthenticatedState(): void {
    // 清空服务端数据后，顶层门禁会立即卸载 Project、WebSocket 与草稿 Runtime。
    this.#queryClient.clear();
    this.#setState({
      error: null,
      loading: false,
      pairing: false,
      status: { authenticated: false, mode: "lan", version: 1 },
    });
  }

  #setState(state: AccessState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

const AccessContext = createContext<AccessContextValue | undefined>(undefined);

export function AccessProvider({
  children,
  client,
  queryClient,
}: Readonly<{
  children: ReactNode;
  client: CodeAgentAccessClient;
  queryClient: QueryClient;
}>) {
  const [controller] = useState(() => new AccessSessionController(client, queryClient));
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    return () => {
      controller.stop();
    };
  }, [controller]);

  const value = useMemo<AccessContextValue>(
    () => ({
      ...state,
      logout: () => controller.logout(),
      pair: (code) => controller.pair(code),
      retry: () => {
        void controller.load();
      },
    }),
    [controller, state],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const value = useContext(AccessContext);
  if (value === undefined) {
    throw new Error("useAccess must be used inside AccessProvider");
  }
  return value;
}
