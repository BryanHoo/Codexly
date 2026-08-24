export type AsyncActionLock = Readonly<{
  run: <Result>(action: () => Promise<Result>) => Promise<Result | undefined>;
}>;

export function createAsyncActionLock(): AsyncActionLock {
  let locked = false;

  return {
    async run<Result>(action: () => Promise<Result>): Promise<Result | undefined> {
      // 在 React 状态刷新前同步抢占，关闭连续点击产生的重复请求窗口。
      if (locked) {
        return undefined;
      }
      locked = true;
      try {
        return await action();
      } finally {
        locked = false;
      }
    },
  };
}
