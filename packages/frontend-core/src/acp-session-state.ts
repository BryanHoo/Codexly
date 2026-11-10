import type { AcpConfigOption, AcpSessionState } from "@codexly/protocol";

export interface AcpSessionReadToken {
  readonly owner: symbol;
  readonly revision: number;
}

/** 每个任务视图持有一份状态；令牌只在本地使用，不进入 ACP 或平台传输。 */
export class AcpSessionStateController {
  readonly #owner = Symbol("acpSessionView");
  readonly #listeners = new Set<() => void>();
  #revision = 0;
  #closed = false;
  #snapshot: AcpSessionState | undefined;
  #json: string | undefined;

  readonly getSnapshot = (): AcpSessionState | undefined => this.#snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.#closed) return () => undefined;
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  capture(): AcpSessionReadToken {
    return { owner: this.#owner, revision: this.#revision };
  }
  #accepts(token: AcpSessionReadToken): boolean {
    return !this.#closed && token.owner === this.#owner && token.revision === this.#revision;
  }
  receive(state: AcpSessionState): void {
    if (this.#closed) return;
    // 相同状态也代表新的权威事件：失效旧读取，但不让选择器重复渲染。
    this.#revision++;
    const json = JSON.stringify(state);
    if (json === this.#json) return;
    this.#json = json;
    this.#snapshot = state;
    for (const listener of this.#listeners) listener();
  }
  commitRead(token: AcpSessionReadToken, state: AcpSessionState): boolean {
    if (!this.#accepts(token)) return false;
    this.receive(state);
    return true;
  }
  commitConfiguration(
    token: AcpSessionReadToken,
    configOptions: readonly AcpConfigOption[],
  ): boolean {
    if (!this.#accepts(token) || !this.#snapshot) return false;
    // ACP 返回的是整份配置；保留最新命令，不把已消失的依赖选项合并回来。
    this.receive({
      configOptions: [...configOptions],
      availableCommands: this.#snapshot.availableCommands,
    });
    return true;
  }
  dispose(): void {
    this.#closed = true;
    this.#listeners.clear();
  }
}
