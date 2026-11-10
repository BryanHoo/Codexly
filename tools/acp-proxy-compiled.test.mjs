import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

for (const engine of ["codex", "claude"]) {
  test(
    `compiled ${engine} agent rejects a damaged proxy snapshot before CLI startup`,
    { skip: !process.env.CODEXLY_COMPILED_ACP_HOST },
    () => {
      const env = {
        ...process.env,
        CODEXLY_NETWORK_PROXY_SNAPSHOT: '{"password":"secret",broken}',
      };
      delete env.CODEXLY_ACP_LIFETIME_SOCKET;
      const result = spawnSync(process.env.CODEXLY_COMPILED_ACP_HOST, ["--acp-agent", engine], {
        env,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.trim(), "ACP_HOST_START_FAILED");
    },
  );
}

test(
  "compiled ACP proxy uses SOCKS remote DNS and releases the bridge on stdin EOF",
  { timeout: 20_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-compiled-proxy-"));
    const sockets = new Set();
    let destination = "";
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      let stage = 0;
      socket.on("data", (data) => {
        if (stage === 0) {
          stage++;
          socket.write(Buffer.from([5, 0]));
        } else if (stage === 1) {
          assert.equal(data[3], 3);
          destination = data.subarray(5, 5 + data[4]).toString();
          stage++;
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
        } else socket.end("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nsocks");
      });
    });
    let child;
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const entry = join(root, "entry.ts"),
        binary = join(root, process.platform === "win32" ? "proxy.exe" : "proxy");
      const bootstrap = fileURLToPath(
        new URL("../packages/provider-acp/src/agent-proxy.ts", import.meta.url),
      );
      const bun = fileURLToPath(new URL("../node_modules/bun/bin/bun.exe", import.meta.url));
      await writeFile(
        entry,
        `import {initializeAcpAgentProxy} from ${JSON.stringify(bootstrap)};
      await initializeAcpAgentProxy();
      const response=await fetch("http://destination.invalid/resource",{signal:AbortSignal.timeout(3000)});
      console.log(await response.text());
      process.stdin.resume();`,
      );
      const built = spawnSync(bun, ["build", entry, "--compile", "--outfile", binary], {
        encoding: "utf8",
        timeout: 15_000,
      });
      assert.equal(built.status, 0, built.stderr);
      child = spawn(binary, [], {
        env: {
          ...process.env,
          CODEXLY_NETWORK_PROXY_SNAPSHOT: JSON.stringify({
            mode: "custom",
            protocol: "socks5",
            host: "127.0.0.1",
            port: server.address().port,
            username: "",
          }),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-4096);
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        if (stdout.includes("socks")) child.stdin.end();
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        const [code, signal] = await once(child, "exit");
        assert.equal(signal, null, stderr);
        assert.equal(code, 0, stderr);
      } finally {
        clearTimeout(timer);
      }
      assert.equal(stdout.trim(), "socks");
      assert.equal(destination, "destination.invalid");
    } finally {
      child?.kill();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  },
);
