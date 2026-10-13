import { describe, expect, it, vi } from "vitest";
import { createConfig, getAutostartPaths } from "./config.js";
import {
  createPlatformAdapter,
  renderLaunchAgent,
  renderSystemdUnit,
  renderWindowsTask,
  selectLinuxTarget,
} from "./platform.js";

const config = createConfig(
  { lan: true },
  {
    node: "/opt/Node & tools/node",
    cli: "/opt/中文/$pkg/dist/cli.js",
    home: "/home/user",
    cwd: "/home/user",
    environment: {},
  },
);

describe("native login services", () => {
  it("waits for asynchronous launchd removal before bootstrapping again", async () => {
    let removing = false;
    let remainingChecks = 2;
    const execute = vi.fn((_command: string, args: readonly string[]) => {
      if (args[0] === "bootout") removing = true;
      if (args[0] === "bootstrap" && remainingChecks >= 0)
        return Promise.resolve({ code: 5, stdout: "", stderr: "Input/output error" });
      return Promise.resolve({
        code: args[0] === "print" && removing && remainingChecks-- <= 0 ? 113 : 0,
        stdout: "",
        stderr: "",
      });
    });
    const adapter = createPlatformAdapter("darwin", getAutostartPaths("darwin", "/test", {}), {
      execute,
      uid: 501,
    });
    await expect(adapter.restart()).resolves.toBeUndefined();
    expect(execute.mock.calls.at(-1)?.[1][0]).toBe("bootstrap");
  });

  it("renders launchd argv without shell interpretation or passwords", () => {
    const xml = renderLaunchAgent(config, "/home/user/private/config.json");
    expect(xml).toContain("Node &amp; tools");
    expect(xml).toContain("<string>run</string>");
    expect(xml).toContain("<key>RunAtLoad</key><true/>");
    expect(xml).toContain("<key>SuccessfulExit</key><false/>");
    expect(xml).not.toContain(config.start.lanPassword);
    expect(xml).not.toContain("/bin/sh");
  });
  it("escapes systemd specifiers, environment expansions and quotes", () => {
    const unit = renderSystemdUnit(
      { ...config, cli: '/path/100%/$evil/"cli.js', linuxTarget: "graphical-session.target" },
      "/tmp/config.json",
    );
    expect(unit).toContain('100%%/$$evil/\\"cli.js');
    expect(unit).toContain("PartOf=graphical-session.target");
    expect(unit).toContain("WantedBy=graphical-session.target");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).not.toContain(config.start.lanPassword);
  });
  it("uses only this user's interactive logon and removes task timeout/battery restrictions", () => {
    const xml = renderWindowsTask(
      { ...config, node: "C:\\Program Files\\node.exe", cli: "C:\\工具\\cli.js" },
      "C:\\private\\config.json",
      "S-1-5-21-123",
    );
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<UserId>S-1-5-21-123</UserId>");
    expect(xml).not.toContain(config.start.lanPassword);
    expect(xml).not.toContain("BootTrigger");
  });
  it("does not permit linger to silently turn login startup into boot startup", () => {
    expect(selectLinuxTarget(false, false)).toBe("default.target");
    expect(selectLinuxTarget(true, true)).toBe("graphical-session.target");
    expect(() => selectLinuxTarget(true, false)).toThrow(/linger/);
  });
  it("checks the user manager and detects linger without changing it", async () => {
    const execute = vi.fn((_command: string, args: readonly string[]) =>
      Promise.resolve({
        code: 0,
        stdout: args.includes("show-user") ? "yes\n" : "",
        stderr: "",
      }),
    );
    const adapter = createPlatformAdapter("linux", getAutostartPaths("linux", "/home/user", {}), {
      execute,
      uid: 1000,
    });
    await expect(adapter.prepare(config)).resolves.toMatchObject({
      linuxTarget: "graphical-session.target",
    });
    expect(execute.mock.calls.flatMap(([, args]) => args)).not.toContain("enable-linger");
  });
  it("removes a disabled Windows task and does not end an already stopped task", async () => {
    const execute = vi.fn((_command: string, args: readonly string[]) => {
      const encoded = args[args.indexOf("-EncodedCommand") + 1];
      const script =
        args.includes("-EncodedCommand") && encoded
          ? Buffer.from(encoded, "base64").toString("utf16le")
          : "";
      return Promise.resolve({
        code: 0,
        stdout: script.includes("WindowsIdentity")
          ? "S-1-5-21-123"
          : script.includes("GetTask")
            ? JSON.stringify({ registered: true, enabled: false, state: 3, lastResult: 0 })
            : "",
        stderr: "",
      });
    });
    const adapter = createPlatformAdapter(
      "win32",
      getAutostartPaths("win32", "/tmp/nonexistent-codexly-test", {}),
      { execute },
    );
    await adapter.remove();
    expect(execute.mock.calls.some(([, args]) => args.includes("/Delete"))).toBe(true);
    expect(execute.mock.calls.some(([, args]) => args.includes("/End"))).toBe(false);
  });
});
