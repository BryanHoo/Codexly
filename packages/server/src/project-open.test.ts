import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createProjectOpenService } from "./project-open.js";

describe("createProjectOpenService", () => {
  it("opens an absolute file reference outside the Project with the system application", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "codexly-open-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "codexly-open-absolute-"));
    const documentPath = join(outsideRoot, "report.docx");
    await writeFile(documentPath, "document");
    const spawnDetached = vi.fn(() => Promise.resolve());
    const service = createProjectOpenService({
      environment: { HOME: "/Users/test" },
      pathExists: (path) => Promise.resolve(path === "/usr/bin/open"),
      platform: "darwin",
      spawnDetached,
    });

    try {
      await service.open(projectRoot, "system-default", documentPath);
      const resolvedDocumentPath = await realpath(documentPath);

      expect(spawnDetached).toHaveBeenCalledWith(
        "/usr/bin/open",
        [resolvedDocumentPath],
        expect.objectContaining({ shell: false }),
      );
    } finally {
      await Promise.all([
        rm(projectRoot, { force: true, recursive: true }),
        rm(outsideRoot, { force: true, recursive: true }),
      ]);
    }
  });

  it("detects installed macOS apps in the official app menu order", async () => {
    const existingPaths = new Set([
      "/usr/bin/open",
      "/Applications/Visual Studio Code.app",
      "/Applications/Zed.app",
      "/Applications/Windsurf.app",
      "/System/Applications/Utilities/Terminal.app",
      "/Applications/Ghostty.app",
      "/Applications/Xcode.app",
      "/Applications/Android Studio.app",
    ]);
    const spawnDetached = vi.fn(() => Promise.resolve());
    const service = createProjectOpenService({
      environment: { HOME: "/Users/test" },
      pathExists: (path) => Promise.resolve(existingPaths.has(path)),
      platform: "darwin",
      spawnDetached,
    });

    await expect(service.getCapabilities()).resolves.toEqual({
      apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "windsurf", kind: "editor", name: "Windsurf" },
        { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
        { id: "system-default", kind: "system-default", name: "系统默认应用" },
        { id: "finder", kind: "file-manager", name: "Finder" },
        { id: "terminal", kind: "terminal", name: "Terminal" },
        { id: "ghostty", kind: "terminal", name: "Ghostty" },
        { id: "xcode", kind: "editor", name: "Xcode" },
        { id: "android-studio", kind: "editor", name: "Android Studio" },
      ],
      platform: "darwin",
    });
    await service.open("/workspace/Codexly", "zed");

    expect(spawnDetached).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-a", "Zed", "/workspace/Codexly"],
      expect.objectContaining({ cwd: "/workspace/Codexly", shell: false }),
    );
  });

  it("keeps each installed Linux app and terminal as an independent choice", async () => {
    const existingPaths = new Set([
      "/usr/bin/xdg-open",
      "/opt/bin/code",
      "/usr/bin/zed",
      "/usr/bin/windsurf",
      "/usr/bin/ghostty",
      "/usr/bin/gnome-terminal",
      "/usr/bin/konsole",
      "/usr/bin/xfce4-terminal",
      "/opt/android-studio/bin/studio.sh",
    ]);
    const spawnDetached = vi.fn(() => Promise.resolve());
    const service = createProjectOpenService({
      environment: { PATH: "/usr/bin:/opt/bin" },
      pathExists: (path) => Promise.resolve(existingPaths.has(path)),
      platform: "linux",
      spawnDetached,
    });

    await expect(service.getCapabilities()).resolves.toEqual({
      apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "windsurf", kind: "editor", name: "Windsurf" },
        { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
        { id: "system-default", kind: "system-default", name: "系统默认应用" },
        { id: "file-manager", kind: "file-manager", name: "文件管理器" },
        { id: "ghostty", kind: "terminal", name: "Ghostty" },
        { id: "gnome-terminal", kind: "terminal", name: "GNOME Terminal" },
        { id: "konsole", kind: "terminal", name: "Konsole" },
        { id: "xfce-terminal", kind: "terminal", name: "Xfce Terminal" },
        { id: "android-studio", kind: "editor", name: "Android Studio" },
      ],
      platform: "linux",
    });
    await service.open("/workspace/Codexly", "konsole");

    expect(spawnDetached).toHaveBeenCalledWith(
      "/usr/bin/konsole",
      ["--workdir", "/workspace/Codexly"],
      expect.objectContaining({ cwd: "/workspace/Codexly", shell: false }),
    );
  });

  it("detects installed Windows editors, Explorer, and terminals", async () => {
    const existingPaths = new Set([
      "C:\\Windows\\explorer.exe",
      "C:\\Windows\\System32\\cmd.exe",
      "C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
      "C:\\Users\\test\\AppData\\Local\\Programs\\Zed\\Zed.exe",
      "C:\\Users\\test\\AppData\\Local\\Programs\\Windsurf\\Windsurf.exe",
      "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
      "C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe",
    ]);
    const spawnDetached = vi.fn(() => Promise.resolve());
    const service = createProjectOpenService({
      environment: {
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
        PATH: "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps",
        ProgramFiles: "C:\\Program Files",
        SystemRoot: "C:\\Windows",
      },
      pathExists: (path) => Promise.resolve(existingPaths.has(path)),
      platform: "win32",
      spawnDetached,
    });

    await expect(service.getCapabilities()).resolves.toEqual({
      apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "windsurf", kind: "editor", name: "Windsurf" },
        { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
        { id: "system-default", kind: "system-default", name: "系统默认应用" },
        { id: "explorer", kind: "file-manager", name: "文件资源管理器" },
        { id: "windows-terminal", kind: "terminal", name: "Windows Terminal" },
        { id: "command-prompt", kind: "terminal", name: "命令提示符" },
        { id: "android-studio", kind: "editor", name: "Android Studio" },
      ],
      platform: "win32",
    });
    await service.open("C:\\workspace\\Codexly", "windsurf");

    expect(spawnDetached).toHaveBeenCalledWith(
      "C:\\Users\\test\\AppData\\Local\\Programs\\Windsurf\\Windsurf.exe",
      ["C:\\workspace\\Codexly"],
      expect.objectContaining({ cwd: "C:\\workspace\\Codexly", shell: false }),
    );
  });

  it("uses Windows broker launch semantics for Explorer and opens Terminal in a new window", async () => {
    const existingPaths = new Set([
      "C:\\Windows\\explorer.exe",
      "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
    ]);
    const spawnDetached = vi.fn(() => Promise.resolve());
    const service = createProjectOpenService({
      environment: {
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
        SystemRoot: "C:\\Windows",
      },
      pathExists: (path) => Promise.resolve(existingPaths.has(path)),
      platform: "win32",
      spawnDetached,
    });
    const projectRoot = "C:\\workspace\\Codexly";

    await service.open(projectRoot, "explorer");
    await service.open(projectRoot, "windows-terminal");

    expect(spawnDetached).toHaveBeenNthCalledWith(
      1,
      "C:\\Windows\\explorer.exe",
      [projectRoot],
      expect.objectContaining({ observeEarlyExit: false }),
    );
    expect(spawnDetached).toHaveBeenNthCalledWith(
      2,
      "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
      ["-w", "new", "-d", projectRoot],
      expect.objectContaining({ observeEarlyExit: true }),
    );
  });

  it("opens file targets with platform-appropriate editor, file manager, and terminal semantics", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "codexly-open-target-"));
    const sourceDirectory = join(projectRoot, "src");
    const sourceFile = join(sourceDirectory, "app.ts");
    await mkdir(sourceDirectory);
    await writeFile(sourceFile, "export {};\n");
    const resolvedProjectRoot = await realpath(projectRoot);
    const resolvedSourceDirectory = join(resolvedProjectRoot, "src");
    const resolvedSourceFile = join(resolvedSourceDirectory, "app.ts");

    try {
      const macSpawn = vi.fn(() => Promise.resolve());
      const macService = createProjectOpenService({
        environment: { HOME: "/Users/test" },
        pathExists: (path) =>
          Promise.resolve(
            new Set([
              "/usr/bin/open",
              "/Applications/Zed.app",
              "/System/Applications/Utilities/Terminal.app",
            ]).has(path),
          ),
        platform: "darwin",
        spawnDetached: macSpawn,
      });
      await macService.open(projectRoot, "zed", "src/app.ts");
      await macService.open(projectRoot, "system-default", "src/app.ts");
      await macService.open(projectRoot, "finder", "src/app.ts");
      await macService.open(projectRoot, "terminal", "src/app.ts");

      expect(macSpawn).toHaveBeenNthCalledWith(
        1,
        "/usr/bin/open",
        ["-a", "Zed", resolvedSourceFile],
        expect.objectContaining({ cwd: resolvedProjectRoot }),
      );
      expect(macSpawn).toHaveBeenNthCalledWith(
        2,
        "/usr/bin/open",
        [resolvedSourceFile],
        expect.objectContaining({ cwd: resolvedProjectRoot }),
      );
      expect(macSpawn).toHaveBeenNthCalledWith(
        3,
        "/usr/bin/open",
        ["-R", resolvedSourceFile],
        expect.objectContaining({ cwd: resolvedProjectRoot }),
      );
      expect(macSpawn).toHaveBeenNthCalledWith(
        4,
        "/usr/bin/open",
        ["-a", "Terminal", resolvedSourceDirectory],
        expect.objectContaining({ cwd: resolvedSourceDirectory }),
      );

      const linuxSpawn = vi.fn(() => Promise.resolve());
      const linuxService = createProjectOpenService({
        environment: { PATH: "/usr/bin" },
        pathExists: (path) =>
          Promise.resolve(new Set(["/usr/bin/xdg-open", "/usr/bin/konsole"]).has(path)),
        platform: "linux",
        spawnDetached: linuxSpawn,
      });
      await linuxService.open(projectRoot, "system-default", "src/app.ts");
      await linuxService.open(projectRoot, "file-manager", "src/app.ts");
      await linuxService.open(projectRoot, "konsole", "src/app.ts");

      expect(linuxSpawn).toHaveBeenNthCalledWith(
        1,
        "/usr/bin/xdg-open",
        [resolvedSourceFile],
        expect.objectContaining({ cwd: resolvedProjectRoot }),
      );
      expect(linuxSpawn).toHaveBeenNthCalledWith(
        2,
        "/usr/bin/xdg-open",
        [resolvedSourceDirectory],
        expect.objectContaining({ cwd: resolvedProjectRoot }),
      );
      expect(linuxSpawn).toHaveBeenNthCalledWith(
        3,
        "/usr/bin/konsole",
        ["--workdir", resolvedSourceDirectory],
        expect.objectContaining({ cwd: resolvedSourceDirectory }),
      );

      const windowsSpawn = vi.fn(() => Promise.resolve());
      const windowsService = createProjectOpenService({
        environment: {
          LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
          SystemRoot: "C:\\Windows",
        },
        pathExists: (path) =>
          Promise.resolve(
            new Set([
              "C:\\Windows\\explorer.exe",
              "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
            ]).has(path),
          ),
        platform: "win32",
        spawnDetached: windowsSpawn,
      });
      await windowsService.open(projectRoot, "system-default", "src/app.ts");
      await windowsService.open(projectRoot, "explorer", "src/app.ts");
      await windowsService.open(projectRoot, "windows-terminal", "src/app.ts");

      expect(windowsSpawn).toHaveBeenNthCalledWith(
        1,
        "C:\\Windows\\explorer.exe",
        [resolvedSourceFile],
        expect.objectContaining({ cwd: resolvedProjectRoot, observeEarlyExit: false }),
      );
      expect(windowsSpawn).toHaveBeenNthCalledWith(
        2,
        "C:\\Windows\\explorer.exe",
        ["/select,", resolvedSourceFile],
        expect.objectContaining({ cwd: resolvedProjectRoot }),
      );
      expect(windowsSpawn).toHaveBeenNthCalledWith(
        3,
        "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
        ["-w", "new", "-d", resolvedSourceDirectory],
        expect.objectContaining({ cwd: resolvedSourceDirectory }),
      );

      await expect(macService.open(projectRoot, "system-default", "src")).rejects.toMatchObject({
        name: "ProjectOpenTargetInvalidError",
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("rejects missing, escaping, and symbolic-link targets before spawning", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "codexly-open-secure-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "codexly-open-outside-"));
    const outsideFile = join(outsideRoot, "outside.ts");
    await writeFile(outsideFile, "export {};\n");
    await symlink(outsideFile, join(projectRoot, "linked.ts"));
    const spawnDetached = vi.fn(() => Promise.resolve());
    const service = createProjectOpenService({
      environment: { HOME: "/Users/test" },
      pathExists: (path) =>
        Promise.resolve(new Set(["/usr/bin/open", "/Applications/Zed.app"]).has(path)),
      platform: "darwin",
      spawnDetached,
    });

    try {
      for (const path of ["missing.ts", "../outside.ts", "linked.ts"]) {
        await expect(service.open(projectRoot, "zed", path)).rejects.toMatchObject({
          name: "ProjectOpenTargetInvalidError",
        });
      }
      expect(spawnDetached).not.toHaveBeenCalled();
    } finally {
      await Promise.all([
        rm(projectRoot, { force: true, recursive: true }),
        rm(outsideRoot, { force: true, recursive: true }),
      ]);
    }
  });

  it("rejects apps that are not available on the current host", async () => {
    const service = createProjectOpenService({
      environment: { PATH: "/usr/bin" },
      pathExists: () => Promise.resolve(false),
      platform: "linux",
      spawnDetached: vi.fn(() => Promise.resolve()),
    });

    await expect(service.getCapabilities()).resolves.toEqual({ apps: [], platform: "linux" });
    await expect(service.open("/workspace/Codexly", "zed")).rejects.toMatchObject({
      name: "ProjectOpenAppUnavailableError",
    });
  });

  it.runIf(process.platform !== "win32")(
    "rejects a host app that exits unsuccessfully during launch",
    async () => {
      const commandRoot = await mkdtemp(join(tmpdir(), "codexly-project-open-"));
      const projectRoot = await mkdtemp(join(tmpdir(), "codexly-project-root-"));
      const launcher = join(commandRoot, "xdg-open");
      try {
        await writeFile(launcher, "#!/bin/sh\nexit 23\n");
        await chmod(launcher, 0o755);
        const service = createProjectOpenService({
          environment: { PATH: commandRoot },
          // CI Worker 启动临时脚本可能超过生产默认观察窗，退出事件仍应决定结果。
          launchConfirmationMs: 5_000,
          platform: "linux",
        });

        await expect(service.open(projectRoot, "file-manager")).rejects.toThrow(
          "exited with code 23",
        );
      } finally {
        await Promise.all([
          rm(commandRoot, { force: true, recursive: true }),
          rm(projectRoot, { force: true, recursive: true }),
        ]);
      }
    },
  );
});
