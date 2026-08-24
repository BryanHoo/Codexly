// 返回 true 表示当前协议领域已经处理该消息。
export function handleTerminalMessage(message) {
  if (message.method === "slow") {
    return true;
  }

  if (message.method === "invalid") {
    process.stdout.write("invalid-jsonl\n");
    return true;
  }

  if (message.method === "crash") {
    process.stderr.write("fake app server crashed\n");
    process.exit(23);
  }
  return false;
}
