use super::runtime_manager::Distribution;

pub(super) const DARWIN_X64: Distribution = Distribution {
    target: "x86_64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.162.0-darwin-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.162.0-darwin-x64.tgz",
    integrity: "4XzCUJgEDDdme6VWDEKvbWDA6f+470d4xhhorYUgNBZwY8Dq5NYqvWkO33rnc1vjxkqSj+SwkymHxRMxL6h1CA==",
};

pub(super) const DARWIN_ARM64: Distribution = Distribution {
    target: "aarch64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.162.0-darwin-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.162.0-darwin-arm64.tgz",
    integrity: "hyiGlMCbZog7IY2TcSWzXbsmtUnynT93QA4utqGlVmFlmz8TurADk3LV28zqUIdgh9GLOzumDIdHQbYieo9Nqw==",
};
pub(super) const LINUX_ARM64: Distribution = Distribution {
    target: "aarch64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.162.0-linux-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.162.0-linux-arm64.tgz",
    integrity: "6NYWwy09FsZ+/0Dz/bvV/yz3aFhkNzj86fSiux9Ax9VMBOID5nPdwd51OySm7fy8TMRud4fgJFELSi3Enc1s7Q==",
};
pub(super) const LINUX_X64: Distribution = Distribution {
    target: "x86_64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.162.0-linux-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.162.0-linux-x64.tgz",
    integrity: "qHWp6oKpf456PqjberGN8avs8zChv2oS+UuDiqVFYAuDOhq6vBc1drh8jEsnR7dBX+zcw03PN5VLtePGlMcC3w==",
};
pub(super) const WINDOWS_ARM64: Distribution = Distribution {
    target: "aarch64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.162.0-win32-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.162.0-win32-arm64.tgz",
    integrity: "scdBHlUz4AfLOUWT4r4kwe3GFvjbBbWxreLDGoLSyMFf566e7sHSJvlJuV7uha2S7uRoQnMmWwmqYMJuT322UQ==",
};
pub(super) const WINDOWS_X64: Distribution = Distribution {
    target: "x86_64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.162.0-win32-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.162.0-win32-x64.tgz",
    integrity: "W8kqHaqpW0qPz71E0rRT5dq+socGz1BbJyYN7o3SP1TWQt8Zl6ML74R9Hvt/xn1NNLVlDTRfXqNmaMkte6yEMQ==",
};
