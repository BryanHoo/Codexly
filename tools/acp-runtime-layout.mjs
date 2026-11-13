import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { join, relative, resolve, isAbsolute, dirname } from "node:path";

function localPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    value.includes("\\") ||
    /^[a-z]:/iu.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid runtime relative path");
  return value;
}
export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
/** 按官方原生包清单解释布局，不能继续猜测旧版 codex/codex 固定位置。 */
export async function readCodexLayout(directory, version, target) {
  const metadata = JSON.parse(await readFile(join(directory, "codex-package.json"), "utf8"));
  if (metadata.layoutVersion !== 1 || metadata.version !== version || metadata.target !== target)
    throw new Error("Codex layout version/target mismatch");
  for (const key of ["entrypoint", "resourcesDir", "pathDir"]) localPath(metadata[key]);
  if (!(await lstat(join(directory, metadata.entrypoint))).isFile())
    throw new Error("Missing Codex executable");
  for (const key of ["resourcesDir", "pathDir"])
    if (!(await lstat(join(directory, metadata[key]))).isDirectory())
      throw new Error("Missing Codex auxiliary directory");
  return metadata;
}
/** 摘要逐文件流式计算；保留内部相对符号链接，但拒绝资源目录逃逸。 */
export async function runtimeInventory(directory) {
  const root = await realpath(directory),
    entries = [];
  async function visit(path, prefix) {
    for (const name of (await readdir(path)).sort()) {
      const full = join(path, name),
        child = prefix ? `${prefix}/${name}` : name;
      const info = await lstat(full);
      if (info.isDirectory()) await visit(full, child);
      else if (info.isSymbolicLink()) {
        const target = await readlink(full);
        const targetPath = resolve(path, target),
          boundary = relative(root, targetPath);
        if (
          isAbsolute(target) ||
          boundary === ".." ||
          boundary.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
          isAbsolute(boundary)
        )
          throw new Error("Runtime symlink escape");
        // 跟随整个链接链再次核对边界，防止两条合法文本链接组合后逃逸。
        const canonical = relative(root, await realpath(full));
        if (
          canonical === ".." ||
          canonical.startsWith("../") ||
          canonical.startsWith("..\\") ||
          isAbsolute(canonical)
        )
          throw new Error("Runtime symlink escape");
        entries.push({ path: child, type: "symlink", target });
      } else if (info.isFile())
        entries.push({ path: child, type: "file", size: info.size, sha256: await sha256(full) });
      else throw new Error("Unsupported runtime file type");
    }
  }
  await visit(root, "");
  return entries;
}
/** 签名前核对完整布局与字节；签名可能改写二进制，安装后的校验不能复用原始摘要。 */
export async function verifyAcpRuntime(directory, target, sidecar) {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform !== target.platform ||
    manifest.arch !== target.arch ||
    manifest.host?.protocolVersion !== 1
  )
    throw new Error("ACP runtime target mismatch");
  const hostPath = localPath(manifest.host.path);
  if (manifest.host.placement !== undefined && manifest.host.placement !== "sidecar")
    throw new Error("Invalid ACP host placement");
  const executables = [
    ...(manifest.host.placement === "sidecar" ? [] : [hostPath]),
    localPath(manifest.engines.codex.entrypoint),
    localPath(manifest.engines.claude.entrypoint),
  ];
  const files = (await runtimeInventory(directory)).filter(
    (entry) => entry.path !== "manifest.json",
  );
  if (!isDeepStrictEqual(files, manifest.files)) throw new Error("ACP runtime integrity mismatch");
  const hostDigest =
    manifest.host.placement === "sidecar"
      ? sidecar && (await lstat(sidecar)).isFile()
        ? await sha256(sidecar)
        : undefined
      : files.find((file) => file.path === hostPath)?.sha256;
  if (hostDigest !== manifest.host.sha256) throw new Error("ACP host digest mismatch");
  for (const path of executables)
    if (!files.some((file) => file.path === path && file.type === "file"))
      throw new Error("ACP runtime executable missing");
  return manifest;
}

/** 通过包的公开入口定位版本/许可，兼容仅 ESM 导出与不公开清单的包。 */
export async function resolveRuntimePackage(require, name) {
  let directory;
  try {
    directory = dirname(require.resolve(`${name}/package.json`));
  } catch (error) {
    if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    directory = dirname(require.resolve(name));
  }
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (manifest.name === name && typeof manifest.version === "string") {
        return directory;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Package manifest not found: ${name}`);
    directory = parent;
  }
}
