use super::runtime_manager::Distribution;

pub(super) const DARWIN_X64: Distribution = Distribution {
    target: "x86_64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.159.0-darwin-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.159.0-darwin-x64.tgz",
    integrity: "uNsvmDAYH2H7/uJi3NYtn0d+bpMHgovZyZwm62Q8q/cdd1rp5oEbk2Axe5pbyiWFwSpjdT6fbuY8gTdX2i7zjg==",
};

pub(super) const DARWIN_ARM64: Distribution = Distribution {
    target: "aarch64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.159.0-darwin-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.159.0-darwin-arm64.tgz",
    integrity: "D1x+5n2y0TE43ERJs3CbBDRPLQl968hpqsInOwYNhfnTOTT53McpfFa6+VfPWwmPi0zW0aJ0C97K+6MhNHYe6A==",
};
pub(super) const LINUX_ARM64: Distribution = Distribution {
    target: "aarch64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.159.0-linux-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.159.0-linux-arm64.tgz",
    integrity: "cm7ihiXIZILGQPWgak3ApOcRZ6beupDNPHVAJ9CyHxZSQPsTy6CSYg1GYLVe2DlRUQYprnXHZceOgheXo0PvHA==",
};
pub(super) const LINUX_X64: Distribution = Distribution {
    target: "x86_64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.159.0-linux-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.159.0-linux-x64.tgz",
    integrity: "7ks+EeQjX33wfJXbggseyF0CJRFVgzDHA6BzC7mJjFsJKmdAuOFWMFeMeZe8vL/G6xEpL29wOdwR85sK49F0iA==",
};
pub(super) const WINDOWS_ARM64: Distribution = Distribution {
    target: "aarch64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.159.0-win32-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.159.0-win32-arm64.tgz",
    integrity: "o4oHXi4IONlLyMRHOIxXTPG1OdbD7Pxmqd2AcYRWHXP1YjrdqdEQozqQLU05rdYGcfrwBwcBqPpGO9LLVHd0fg==",
};
pub(super) const WINDOWS_X64: Distribution = Distribution {
    target: "x86_64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.159.0-win32-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.159.0-win32-x64.tgz",
    integrity: "Fp+TghoUzxOguHj/WAxOIZCIJpTOb4pB9p90tf6+g2PSTWSCvqpawwxPmDuCMxKs8Sn1gO5zP621PoCkBt5cuQ==",
};
