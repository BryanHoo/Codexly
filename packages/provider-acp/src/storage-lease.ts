import { randomUUID } from "node:crypto";
import type { LocalCatalogStore } from "@codexly/core";

/** 不依赖过期时间的存储写入协调器；只有确认原进程不存在才尝试原子接管。 */
export class AcpStorageLeases {
  constructor(readonly store: LocalCatalogStore) {}
  async acquire(key: string): Promise<() => Promise<void>> {
    const previous = await this.store.catalog("acp.storage.read", { key });
    if (previous) {
      let dead = false;
      try {
        process.kill(previous.pid, 0);
      } catch (error) {
        dead = (error as NodeJS.ErrnoException).code === "ESRCH";
      }
      // PID 重用、权限不足及无法判断均报忙，不能把活进程的锁当作超时记录删除。
      if (!dead) throw new Error("ACP 存储正在写入，请稍后重试");
    }
    const owner = randomUUID();
    let acquired: boolean;
    try {
      acquired = await this.store.catalog("acp.storage.claim", {
        key,
        owner,
        pid: process.pid,
        expectedOwner: previous?.owner ?? null,
      });
    } catch (error) {
      // 领取可能已经提交但回执丢失；尚未执行文件写入，只能按本次 token 清理。
      // 同一仓储按序处理请求，迟到领取先于该释放；绝不能释放其他持有者的记录。
      try {
        await this.store.catalog("acp.storage.release", { key, owner });
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "ACP 存储锁状态未知，请重启宿主后恢复", {
          cause: cleanup,
        });
      }
      throw error;
    }
    // 比较原 owner 后再接管；另一个回收者已经成功时明确报忙，不自动重试。
    if (!acquired) throw new Error("ACP 存储正在写入或锁容量已满，请稍后重试");
    return async () => {
      const released = await this.store.catalog("acp.storage.release", { key, owner });
      if (!released) throw new Error("ACP 存储锁所有权已改变");
    };
  }
}
