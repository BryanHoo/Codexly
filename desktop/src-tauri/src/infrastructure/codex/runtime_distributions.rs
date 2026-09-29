use super::runtime_manager::Distribution;

pub(super) const DARWIN_X64: Distribution = Distribution {
    target: "x86_64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.158.0-darwin-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.158.0-darwin-x64.tgz",
    integrity: "FrX1o3APrL7F6QkO8z08Rq8lJitH2sNI7pkebA02eYA103hDs3fyy9d32zeLLQJUeAhmZA4pV9xJR4m7cVyNpQ==",
};

pub(super) const DARWIN_ARM64: Distribution = Distribution {
    target: "aarch64-apple-darwin",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.158.0-darwin-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.158.0-darwin-arm64.tgz",
    integrity: "0OKSjlWY1j4Ld1fT87QttNw3Y2SthcXi4GcrWSHjleZg1n86eG3+shJl4Pv+siUmsBJhWlNmm6rRO4Yv8ZyQLg==",
};
pub(super) const LINUX_ARM64: Distribution = Distribution {
    target: "aarch64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.158.0-linux-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.158.0-linux-arm64.tgz",
    integrity: "T9AgGcoU7HNsxJ4prT/R9YvztyEmz9kWP/VlT2cbCop4PVwiqfG9YMJtLo4j2ScewvSaTl4sQFwla+fwGpoRZg==",
};
pub(super) const LINUX_X64: Distribution = Distribution {
    target: "x86_64-unknown-linux-musl",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.158.0-linux-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.158.0-linux-x64.tgz",
    integrity: "mY12GZPM8TuOWVGxCyNV2NSA8t1uIupm9Nhu9VeQVEvvxBKN08U8bLH+vn7oISUHZPC8bwhROIbo/ZUxqV6XMg==",
};
pub(super) const WINDOWS_ARM64: Distribution = Distribution {
    target: "aarch64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.158.0-win32-arm64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.158.0-win32-arm64.tgz",
    integrity: "Jw1u0q0+5PG97jPkINxE3UCFtsYBN8Af+IjjM0zlCO675Sv5lNsXU2K9aIaXwVeQIKw8q2lbPAR4SEkq2rSOoA==",
};
pub(super) const WINDOWS_X64: Distribution = Distribution {
    target: "x86_64-pc-windows-msvc",
    url: "https://registry.npmmirror.com/@openai/codex/-/codex-0.158.0-win32-x64.tgz",
    fallback_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.158.0-win32-x64.tgz",
    integrity: "IaUmY11Zdqa/Zok6kE0Z5375pXtClKRbS8P1Gh2C73Aq65CaGn9N8gT6BXGC3+XD6yamAIiEQW5xM842UCCGow==",
};
