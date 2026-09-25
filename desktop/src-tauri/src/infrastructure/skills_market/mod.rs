mod catalog;
mod client;
mod compatibility;
mod installer;

use thiserror::Error;

pub use client::{
    DownloadedSkillArchive, download_skill_archive, get_clawhub_skill, list_clawhub_skills,
};
pub use installer::{InstallResult, install_clawhub_archive};

#[derive(Debug, Error)]
pub enum SkillsMarketError {
    #[error("ClawHub request failed")]
    Network,
    #[error("ClawHub response is invalid")]
    InvalidResponse,
    #[error("ClawHub rate limit reached; retry later")]
    RateLimited,
    #[error("skill is not compatible with Codex")]
    Incompatible,
    #[error("skill package was not found")]
    NotFound,
    #[error("skill directory contains local or unrelated files")]
    Conflict,
    #[error("skill package failed the security scan")]
    Unsafe,
    #[error("skill archive is invalid")]
    InvalidArchive,
    #[error("skill filesystem operation failed")]
    Filesystem,
}

impl SkillsMarketError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Network => "SKILL_MARKET_NETWORK",
            Self::InvalidResponse => "SKILL_MARKET_INVALID_RESPONSE",
            Self::RateLimited => "SKILL_MARKET_RATE_LIMITED",
            Self::Incompatible => "SKILL_MARKET_INCOMPATIBLE",
            Self::NotFound => "SKILL_MARKET_NOT_FOUND",
            Self::Conflict => "SKILL_MARKET_CONFLICT",
            Self::Unsafe => "SKILL_MARKET_UNSAFE",
            Self::InvalidArchive => "SKILL_MARKET_INVALID_ARCHIVE",
            Self::Filesystem => "SKILL_MARKET_FILESYSTEM",
        }
    }
}
