use super::runtime_manager::Distribution;

pub(super) const DARWIN_X64: Distribution = Distribution {
    target: "x86_64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.161.0-darwin-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.161.0-darwin-x64.tgz",
    integrity: "svVXwOisMkf/e9BD8Qyp0BQYOTsRnrYErfLq+o7aNMts8Evg06rRsHUfxH6HAiJ99dUgC/4CLr3Rpwh3833TfQ==",
};

pub(super) const DARWIN_ARM64: Distribution = Distribution {
    target: "aarch64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.161.0-darwin-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.161.0-darwin-arm64.tgz",
    integrity: "arxKLYB3uKjewwOpGFo5/MGe8+4JzNB17KIYBmGfF4k3QU+QC4ieXVUwqHmQX2nXrB1BzNMN0gtAgm1AGBTg8w==",
};
pub(super) const LINUX_ARM64: Distribution = Distribution {
    target: "aarch64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.161.0-linux-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.161.0-linux-arm64.tgz",
    integrity: "SBu0n4C1Pby9rGKUNA02yHEg/ScbECgiTIiKiKhbYWiUWqGPV1hY0Br7joEntbz0dyNzSWqNPD8uOqxcOry/Fg==",
};
pub(super) const LINUX_X64: Distribution = Distribution {
    target: "x86_64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.161.0-linux-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.161.0-linux-x64.tgz",
    integrity: "AVkNzeJWyCHHPyg5vxD8UE6aFsYaOwq0/x6mtmkOKy6LdjvsyxLr7Q7UULlk+Ma3+PnrN8uIxG2/XGPQ936hgA==",
};
pub(super) const WINDOWS_ARM64: Distribution = Distribution {
    target: "aarch64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.161.0-win32-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.161.0-win32-arm64.tgz",
    integrity: "tgo++ui5X5pXkaz113Q4/PNVviWXlvUdHH4zY+SoGwHm4720JsRPjuUJcUNZ9WtryEiw3Xpj5nKp8pgCXJUjYA==",
};
pub(super) const WINDOWS_X64: Distribution = Distribution {
    target: "x86_64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.161.0-win32-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.161.0-win32-x64.tgz",
    integrity: "VdNnttGOG3nbwoREvVurVBXci/EJD/kncVJnvtXjpEE+YhC1twvvrVNmtlZcZGEEVi06xLN/ov0d6nxjZ1XLSg==",
};
