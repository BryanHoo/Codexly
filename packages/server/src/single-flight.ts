export async function runSingleFlight<Key, Value>(
  inFlight: Map<Key, Promise<Value>>,
  key: Key,
  operation: () => Promise<Value>,
): Promise<Value> {
  const existing = inFlight.get(key);
  if (existing !== undefined) {
    return existing;
  }
  // 先登记 Promise 再执行异步操作，避免同步重入绕过 single-flight。
  const pending = Promise.resolve().then(operation);
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(key) === pending) {
      inFlight.delete(key);
    }
  }
}
