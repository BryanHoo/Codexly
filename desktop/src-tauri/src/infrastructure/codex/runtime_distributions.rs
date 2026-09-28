use super::runtime_manager::Distribution;

pub(super) const DARWIN_X64: Distribution = Distribution {
    target: "x86_64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.157.1-darwin-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.157.1-darwin-x64.tgz",
    integrity: "PscZvqKD4zlaSw1nM5Sh4lU1M+01sr4b3qzGx8pf+4OLyULg1z1yAyTR1c35C3t62H8DXy/14y7oazTR3JMMKA==",
};

pub(super) const DARWIN_ARM64: Distribution = Distribution {
    target: "aarch64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.157.1-darwin-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.157.1-darwin-arm64.tgz",
    integrity: "62/e4TZ34z93KK3FYIHmo/K88aH0JRPA8x7SAVBdK4iG9f9HPO2tsDrJcmOj9z6DrFpMvPEVymomCbYpqN+ylQ==",
};
pub(super) const LINUX_ARM64: Distribution = Distribution {
    target: "aarch64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.157.1-linux-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.157.1-linux-arm64.tgz",
    integrity: "nEaBZT3ldrtqUNaBlvI+Y+fg+LbNCTsQjbUnl7Q45rl9vSSqHU2vRj1l6iJDwupZkrpeIJ/ClHIwxgMKv1SKHg==",
};
pub(super) const LINUX_X64: Distribution = Distribution {
    target: "x86_64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.157.1-linux-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.157.1-linux-x64.tgz",
    integrity: "Eac8XlC0nCXSeUjDU9l8yLJ6P9evv1mO+AnvILoNwlegBC7B3AVXqJ05QcMhQX7RcJ3Lk2618ykCb2X2ui8VAQ==",
};
pub(super) const WINDOWS_ARM64: Distribution = Distribution {
    target: "aarch64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.157.1-win32-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.157.1-win32-arm64.tgz",
    integrity: "tFkxdrSXPUDQXXp3JwTxNOgI17RQcexyuaZTiNmL1A/UaVtVmVBNe+8cBk3r8b7dLpaoWFbjPwL7p5SBCrkLQg==",
};
pub(super) const WINDOWS_X64: Distribution = Distribution {
    target: "x86_64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.157.1-win32-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.157.1-win32-x64.tgz",
    integrity: "vgqs/VRXNwhLYMsZDgYfnRSXpRh5Nm782L8lacGskw86kOxbMaquvQKxkuZHUBrJA2XGcksB7rMUHy1XaCJgrA==",
};
