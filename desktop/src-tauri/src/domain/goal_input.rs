use super::conversation::{AgentPromptInput, AgentTurnOptions};

const MAX_OBJECTIVE_CHARS: usize = 4_000;

#[derive(Debug, thiserror::Error)]
pub enum GoalInputError {
    #[error("goal objective must not be empty")]
    Required,
    #[error("goal objective must be at most 4000 characters")]
    TooLong,
    #[error("goal input cannot contain attachments or skills")]
    StructuredInput,
}

impl GoalInputError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Required => "GOAL_OBJECTIVE_REQUIRED",
            Self::TooLong => "GOAL_OBJECTIVE_TOO_LONG",
            Self::StructuredInput => "GOAL_STRUCTURED_INPUT_UNSUPPORTED",
        }
    }
}

pub fn validate_objective(objective: &str) -> Result<&str, GoalInputError> {
    let objective = objective.trim();
    if objective.is_empty() {
        return Err(GoalInputError::Required);
    }
    // 与 Codex 0.156.0 的 Unicode 标量计数一致，超限即停止，不分配正文副本。
    if objective.chars().nth(MAX_OBJECTIVE_CHARS).is_some() {
        return Err(GoalInputError::TooLong);
    }
    Ok(objective)
}

pub fn validate_turn_input(
    input: &AgentPromptInput,
    options: &AgentTurnOptions,
) -> Result<(), GoalInputError> {
    if !options.goal_mode {
        return Ok(());
    }
    validate_objective(&input.text)?;
    if !input.attachments.is_empty() || !input.skills.is_empty() {
        return Err(GoalInputError::StructuredInput);
    }
    Ok(())
}
