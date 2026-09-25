const MACOS_TARGETS = { arm64: "aarch64-apple-darwin", x64: "x86_64-apple-darwin" };

function findTarget(argumentsList) {
  for (let index = 1; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--target" || argument === "-t") {
      return argumentsList[index + 1];
    }
    if (argument.startsWith("--target=")) {
      return argument.slice("--target=".length);
    }
  }
  return undefined;
}

function hasBundleSelection(argumentsList) {
  return argumentsList.some(
    (argument) =>
      argument === "--no-bundle" ||
      argument === "--bundles" ||
      argument === "-b" ||
      argument.startsWith("--bundles="),
  );
}

export function resolveTauriArguments(
  argumentsList,
  platform = process.platform,
  arch = process.arch,
  profile = "modern",
) {
  const resolved = [...argumentsList];
  if (profile !== "modern" && profile !== "legacy") {
    throw new Error(`Unknown macOS build profile: ${profile}`);
  }
  if (profile === "legacy" && (platform !== "darwin" || resolved[0] !== "build")) {
    throw new Error("Legacy only supports macOS production builds");
  }
  if (resolved[0] !== "build") {
    return resolved;
  }

  if (platform === "win32") {
    if (!hasBundleSelection(resolved)) {
      // Windows 默认输出可直接运行的 EXE，避免生成需要安装的 NSIS/MSI 包。
      resolved.splice(1, 0, "--no-bundle");
    }
    return resolved;
  }

  if (platform !== "darwin") {
    return resolved;
  }

  const explicitTarget = findTarget(resolved);
  if (profile === "legacy" && explicitTarget && explicitTarget !== MACOS_TARGETS.x64) {
    throw new Error("Legacy requires x86_64-apple-darwin");
  }
  if (explicitTarget && !Object.values(MACOS_TARGETS).includes(explicitTarget)) {
    throw new Error(`Unsupported macOS target: ${explicitTarget}`);
  }
  if (!explicitTarget) {
    const target = profile === "legacy" ? MACOS_TARGETS.x64 : MACOS_TARGETS[arch];
    if (!target) throw new Error(`Unsupported macOS architecture: ${arch}`);
    // 本机构建匹配宿主架构；CI 可以显式选择另一架构交叉编译。
    resolved.splice(1, 0, "--target", target);
  }
  if (profile === "legacy") {
    // 最后合并兼容配置，确保前端目录、最低系统与更新端点属于同一档构建。
    resolved.push("--config", "src-tauri/tauri.macos-legacy.conf.json");
  }
  return resolved;
}

export function resolveTauriEnvironment(
  argumentsList,
  platform = process.platform,
  profile = "modern",
) {
  if (platform !== "darwin" || argumentsList[0] !== "build") {
    return {};
  }

  return {
    // macOS 27 会拒绝 Rust strip 产生的异常 proc-macro Mach-O，仅禁用宿主构建依赖的 strip。
    CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP: "false",
    MACOSX_DEPLOYMENT_TARGET: profile === "legacy" ? "12.4" : "14.5",
  };
}
