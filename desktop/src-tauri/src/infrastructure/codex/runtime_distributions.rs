use super::runtime_manager::Distribution;

pub(super) const DARWIN_X64: Distribution = Distribution {
    target: "x86_64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.156.0-darwin-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.156.0-darwin-x64.tgz",
    integrity: "fD6Nxn7rxinrE6JRxN1liMH3rIV2j9HjcszwMprgs3Ka2p6rR60CmvN03RsWOT4vCcxnA7Evhpnm+bCTNVhH+g==",
};

pub(super) const DARWIN_ARM64: Distribution = Distribution {
    target: "aarch64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.156.0-darwin-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.156.0-darwin-arm64.tgz",
    integrity: "43/9bryLjRA+g7z1AGeFS8AQiChmG52nIhzMkxjNAXcxEBMVsA88YGBosk0ndThjgTGB42vK82BQV3DR6OBsGQ==",
};
pub(super) const LINUX_ARM64: Distribution = Distribution {
    target: "aarch64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.156.0-linux-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.156.0-linux-arm64.tgz",
    integrity: "IfUrjxm8RAdzPgqlPhUXTJ4mGKKbuTKsNixiXoiRzNkd9kNLj/fUmOQYCcWu+3Dk77b4OH1itnoIRAcFimNzNQ==",
};
pub(super) const LINUX_X64: Distribution = Distribution {
    target: "x86_64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.156.0-linux-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.156.0-linux-x64.tgz",
    integrity: "/PX399ISB715skgBBOtOX5aqLxmPQhYC7wDasZnAJhRrtzt3qgs6kjSnimN9T8OFKv4LDAp+uJdN896tQYaTrA==",
};
pub(super) const WINDOWS_ARM64: Distribution = Distribution {
    target: "aarch64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.156.0-win32-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.156.0-win32-arm64.tgz",
    integrity: "kDs2Sz+oDAcAm6n5C1TkN6qy7ZNWZiDPM7Uj0Z913I+SFLOYTkF/OB2SWYFG73jF/gKLrkIpWZFdIvFUaMBWfw==",
};
pub(super) const WINDOWS_X64: Distribution = Distribution {
    target: "x86_64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.156.0-win32-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.156.0-win32-x64.tgz",
    integrity: "9y+shxtHJn7yrmZqF4gs9oK1Tte9Heshkda8TrTiAf3bPn24cgOq+avZ+Mad54I3M2R8AFeqt0hT/aS6s5cbAQ==",
};
