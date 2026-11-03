import type { SavedPromptsRequest, SharedSavedPrompt } from "@codexly/protocol";

/** 迁移、刷新和写操作串行执行，避免迟到读取覆盖刚完成的保存；不创建后台轮询。 */
export function createSavedPromptsSync(options: {
  request: (input: SavedPromptsRequest) => Promise<SharedSavedPrompt[]>;
  readLegacy: () => readonly SharedSavedPrompt[];
  clearLegacy: () => void;
  publish: (prompts: readonly SharedSavedPrompt[]) => void;
}) {
  let migrated = false;
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(action: () => Promise<T>): Promise<T> => {
    const next = tail.then(action);
    tail = next.catch(() => undefined);
    return next;
  };
  const initialize = async () => {
    if (migrated) return;
    const legacy = options.readLegacy();
    // 分批导入有界请求；回执保证部分成功后重试也不会覆盖远端修改。
    for (let offset = 0; offset < legacy.length; offset += 100) {
      await options.request({ action: "import", prompts: legacy.slice(offset, offset + 100) });
    }
    options.clearLegacy();
    migrated = true;
  };
  const run = (input: SavedPromptsRequest) =>
    enqueue(async () => {
      await initialize();
      const prompts = await options.request(input);
      options.publish(prompts);
      return prompts;
    });
  let refresh: Promise<SharedSavedPrompt[]> | undefined;
  return {
    run,
    refresh() {
      // 分屏的多个订阅和同一轮 focus/visibility 事件只发起一次刷新。
      return (refresh ??= run({ action: "list" }).finally(() => {
        refresh = undefined;
      }));
    },
  };
}
