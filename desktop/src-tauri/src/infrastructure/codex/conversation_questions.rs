use serde_json::{Map, Value};

use super::connection::ConnectionError;
use crate::domain::conversation::AgentAsyncQuestion;

pub(super) fn map_questions(
    item: &Map<String, Value>,
) -> Result<Option<Vec<AgentAsyncQuestion>>, ConnectionError> {
    if item.get("delivery").and_then(Value::as_str) != Some("async") {
        return Ok(None);
    }
    let Some(value) = item.get("questions").filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let questions = value.as_array().ok_or(ConnectionError::InvalidMessage)?;
    // 超出交互预算时保留官方 text，避免巨大表单增加 IPC 和渲染负担。
    if questions.is_empty() || questions.len() > 16 {
        return Ok(None);
    }
    let mut bytes = 0;
    for question in questions {
        let title = question["title"]
            .as_str()
            .ok_or(ConnectionError::InvalidMessage)?;
        if title.trim().is_empty() || title.len() > 4096 {
            return Ok(None);
        }
        bytes += title.len();
        if let Some(options) = question.get("options").filter(|value| !value.is_null()) {
            let options = options.as_array().ok_or(ConnectionError::InvalidMessage)?;
            if options.is_empty() || options.len() > 32 {
                return Ok(None);
            }
            for option in options {
                let option = option.as_str().ok_or(ConnectionError::InvalidMessage)?;
                if option.trim().is_empty() || option.len() > 1024 {
                    return Ok(None);
                }
                bytes += option.len();
            }
        }
    }
    if bytes > 65_536 {
        return Ok(None);
    }
    serde_json::from_value(value.clone())
        .map(Some)
        .map_err(Into::into)
}
