/** Tauri 的目标架构可能不同于构建宿主（例如 Apple Silicon 上构建 Intel 包）。 */
export function claudeBuildTarget(triple, platform = process.platform, arch = process.arch) {
  if (!triple) return { platform, arch };
  const match = /^(aarch64|x86_64)-(?:apple-darwin|pc-windows-msvc|unknown-linux-gnu)$/u.exec(
    triple,
  );
  if (!match) throw new Error(`Unsupported Claude build target: ${triple}`);
  return {
    platform: triple.includes("darwin") ? "darwin" : triple.includes("windows") ? "win32" : "linux",
    arch: match[1] === "aarch64" ? "arm64" : "x64",
  };
}
