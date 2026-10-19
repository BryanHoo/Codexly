import type { ProjectRuntimeContext } from "./routes/context.js";

interface TaskLease {
  submissions: number;
  releasing?: Promise<Awaited<ReturnType<ProjectRuntimeContext["provider"]["unsubscribeTask"]>>>;
}

// 只保留正在提交或退订的任务；空闲即删除，不随项目历史数量增长。
const runtimeLeases = new WeakMap<ProjectRuntimeContext, Map<string, TaskLease>>();

function leaseFor(runtime: ProjectRuntimeContext, taskId: string) {
  let leases = runtimeLeases.get(runtime);
  if (leases === undefined) {
    leases = new Map();
    runtimeLeases.set(runtime, leases);
  }
  let lease = leases.get(taskId);
  if (lease === undefined) {
    lease = { submissions: 0 };
    leases.set(taskId, lease);
  }
  const cleanup = () => {
    if (lease.submissions === 0 && lease.releasing === undefined) leases.delete(taskId);
  };
  return { lease, cleanup };
}

export async function retainTaskExecution(runtime: ProjectRuntimeContext, taskId: string) {
  const { lease, cleanup } = leaseFor(runtime, taskId);
  // 必须先同步占用，再等待旧退订结束。调用方随后重新读取归属，避免读完后被退订清除。
  lease.submissions += 1;
  await lease.releasing?.catch(() => undefined);
  return () => {
    lease.submissions -= 1;
    cleanup();
  };
}

export async function unsubscribeIdleTask(runtime: ProjectRuntimeContext, taskId: string) {
  const { lease, cleanup } = leaseFor(runtime, taskId);
  if (lease.submissions > 0) return "busy" as const;
  if (lease.releasing !== undefined) return lease.releasing;
  // 先登记退订 Promise，后执行 Provider，保证新提交可以等待同一次释放完成。
  lease.releasing = Promise.resolve().then(() => runtime.provider.unsubscribeTask(taskId));
  try {
    return await lease.releasing;
  } finally {
    delete lease.releasing;
    cleanup();
  }
}
