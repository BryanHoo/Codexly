use super::runtime_manager::Distribution;

pub(super) const DARWIN_X64: Distribution = Distribution {
    target: "x86_64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.160.0-darwin-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.160.0-darwin-x64.tgz",
    integrity: "ir7cdsPrb9VkqNqpTECoTiomv04xws/FQ968mHQzuL+2J5Da0Dkh2Qlxp7sguDDZJab4YpYmNjQvBVMXbTeQaQ==",
};

pub(super) const DARWIN_ARM64: Distribution = Distribution {
    target: "aarch64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.160.0-darwin-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.160.0-darwin-arm64.tgz",
    integrity: "aefV6cqZA2REZgR//4McyXlp7zLcTti4CI2v3j9IVgNndPBv2kCeNEcz07qeelXcwOdSFPUKb6roA48vZmDgrQ==",
};
pub(super) const LINUX_ARM64: Distribution = Distribution {
    target: "aarch64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.160.0-linux-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.160.0-linux-arm64.tgz",
    integrity: "VnVdsS06YlDsL8OwaJjQ3xdqdJNG4i+eBJBV3LytddknzSaF/urijLzVg3ptkwvoj8C7Gn7iWpVE+y8WEaPiCg==",
};
pub(super) const LINUX_X64: Distribution = Distribution {
    target: "x86_64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.160.0-linux-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.160.0-linux-x64.tgz",
    integrity: "KI/73OqGrHmR18s7ya7E1NqV6rT0y3lxr0s8S1qR2m6zU6QRF/HlR529jALLh5vjdUnsRT4Ahoxt0axb4kY99g==",
};
pub(super) const WINDOWS_ARM64: Distribution = Distribution {
    target: "aarch64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.160.0-win32-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.160.0-win32-arm64.tgz",
    integrity: "tTvK9ZIGuj9WnYaYOAnfjJVSfPV7dKqWtDHqUPLf0Hadp6SgynTxx7S7iMXRieFeXVOI2XH76KxEHSOTOnz3zw==",
};
pub(super) const WINDOWS_X64: Distribution = Distribution {
    target: "x86_64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.160.0-win32-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.160.0-win32-x64.tgz",
    integrity: "/gCFcuOmGlQkgGivWCtY8BNEDixh70Pue0HZOk9S8bj2vUIE1GLD9zcNB/KqqDJmn0S+lIttauLpzQnw6HOCHA==",
};
