#!/usr/bin/env node

import { createInterface } from "node:readline";
import { send } from "./fake-app-server-base.mjs";
import { handleActionMessage } from "./fake-app-server-actions.mjs";
import { handleProtocolMessage } from "./fake-app-server-protocol.mjs";
import { state } from "./fake-app-server-state.mjs";
import { handleTerminalMessage } from "./fake-app-server-terminal.mjs";

if (state.args.includes("--version")) {
  process.stdout.write("codex-cli 0.151.0\n");
  process.exit(0);
}

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
