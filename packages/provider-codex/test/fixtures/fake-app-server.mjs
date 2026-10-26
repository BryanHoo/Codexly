#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import samples from "./startup-config.json" with { type: "json" };

import { createInterface } from "node:readline";
import { send } from "./fake-app-server-base.mjs";
import { handleActionMessage } from "./fake-app-server-actions.mjs";
import { handleProtocolMessage } from "./fake-app-server-protocol.mjs";
import { state } from "./fake-app-server-state.mjs";
import { handleTerminalMessage } from "./fake-app-server-terminal.mjs";

if (state.args.includes("--version")) {
  process.stdout.write("codex-cli 0.164.0\n");
  process.exit(0);
}

// 一次性预检样本供真实子进程边界回归使用，不进入 JSONL 握手。
if (state.args.includes("--print-startup-config")) {
  if (process.env.FAKE_STARTUP_TRACE) appendFileSync(process.env.FAKE_STARTUP_TRACE, "probe\n");
  const client = JSON.parse(state.args.at(-1));
  if (
    client.name !== "codexly" ||
    state.args.includes("--listen") ||
    state.args.includes("--startup-sign-out")
  )
    process.exit(64);
  const key = process.env.FAKE_STARTUP_RESULT ?? "success";
  if (key === "timeout") {
    setInterval(() => {}, 1000);
  } else if (key === "oversize") {
    process.stdout.write("x".repeat(1_048_577));
  } else {
    process.stdout.write(JSON.stringify(samples[key] ?? {}) + "\n");
    process.exitCode = key === "success" ? 0 : 1;
  }
} else {
  if (JSON.stringify(state.args) !== JSON.stringify(state.expectedArgs)) {
    process.stderr.write(`unexpected argv: ${JSON.stringify(state.args)}\n`);
    process.exit(64);
  }

  const input = createInterface({ input: process.stdin });

  input.on("line", (line) => {
    const message = JSON.parse(line);
    if (handleProtocolMessage(message)) return;
    if (handleActionMessage(message)) return;
    if (handleTerminalMessage(message)) return;
    send({ error: { code: -32601, message: "Method not found" }, id: message.id });
  });

  input.on("close", () => {
    process.exit(0);
  });
}
