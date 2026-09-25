use serde_json::{Value, json};

use super::connection::ConnectionError;
use super::conversation_file_input::create_file_text_input;
use crate::domain::conversation::AgentPromptInput;

pub(super) fn map_prompt_input(input: &AgentPromptInput) -> Result<Vec<Value>, ConnectionError> {
    let mut native = Vec::with_capacity(1 + input.attachments.len() + input.skills.len());
    if !input.text.is_empty() {
        native.push(json!({"text": input.text, "text_elements": [], "type": "text"}));
    }
    for attachment in &input.attachments {
        match attachment.get("kind").and_then(Value::as_str) {
            Some("file") if is_audio_attachment(attachment) => native.push(json!({
                "path": object_string(attachment, "id")?,
                "type": "localAudio",
            })),
            Some("file" | "text") => native.push(create_file_text_input(attachment)?),
            None | Some("image") => native.push(json!({
                "detail": image_detail(attachment)?,
                "path": object_string(attachment, "id")?,
                "type": "localImage",
            })),
            _ => return Err(ConnectionError::InvalidMessage),
        }
    }
    for skill in &input.skills {
        native.push(json!({
            "name": object_string(skill, "name")?,
            "path": object_string(skill, "id")?,
            "type": "skill",
        }));
    }
    if native.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(native)
}

fn image_detail(attachment: &Value) -> Result<&str, ConnectionError> {
    match attachment.get("detail").and_then(Value::as_str) {
        None => Ok("auto"),
        Some(detail @ ("auto" | "low" | "high" | "original")) => Ok(detail),
        Some(_) => Err(ConnectionError::InvalidMessage),
    }
}

fn is_audio_attachment(attachment: &Value) -> bool {
    attachment
        .get("id")
        .and_then(Value::as_str)
        .and_then(|path| std::path::Path::new(path).extension())
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "m4a" | "mp3" | "ogg" | "wav" | "webm"
            )
        })
}

fn object_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, ConnectionError> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(ConnectionError::InvalidMessage)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_text_should_follow_codex_152_wire_schema() {
        let input = AgentPromptInput::text("读取附件");
        let native = map_prompt_input(&input).expect("prompt should map");

        assert_eq!(native[0]["text_elements"], json!([]));
        assert!(native[0].get("textElements").is_none());
    }

    #[test]
    fn skill_prompt_should_preserve_marker_and_structured_input() {
        let input = AgentPromptInput {
            attachments: Vec::new(),
            skills: vec![json!({"id": "/skills/review/SKILL.md", "name": "review"})],
            text: "$review 检查代码".to_owned(),
        };
        let native = map_prompt_input(&input).expect("skill prompt should map");

        assert_eq!(native[0]["text"], "$review 检查代码");
        assert_eq!(
            native[1],
            json!({
                "type": "skill",
                "name": "review",
                "path": "/skills/review/SKILL.md",
            })
        );
    }

    #[test]
    fn prompt_file_should_preserve_attachment_identity_in_text_elements() {
        let path = std::env::temp_dir()
            .join("report.json")
            .to_string_lossy()
            .into_owned();
        let input = AgentPromptInput {
            attachments: vec![json!({
                "id": &path,
                "kind": "file",
                "mediaType": "application/json",
                "name": "report.json",
                "size": 17,
            })],
            skills: Vec::new(),
            text: "检查附件".to_owned(),
        };

        let native = map_prompt_input(&input).expect("file prompt should map");
        assert_eq!(native[1]["text"], path);
        assert_eq!(
            native[1]["text_elements"][0]["byteRange"],
            json!({"start": 0, "end": path.len()})
        );
        assert!(
            native[1]["text_elements"][0]["placeholder"]
                .as_str()
                .is_some_and(|value| value.starts_with("codexly-file:"))
        );
    }

    #[test]
    fn prompt_audio_file_should_use_codex_local_audio_input() {
        let path = std::env::temp_dir()
            .join("recording.mp3")
            .to_string_lossy()
            .into_owned();
        let input = AgentPromptInput {
            attachments: vec![json!({
                "id": &path,
                "kind": "file",
                "mediaType": "audio/mpeg",
                "name": "recording.mp3",
                "size": 17,
            })],
            skills: Vec::new(),
            text: String::new(),
        };

        let native = map_prompt_input(&input).expect("audio prompt should map");
        assert_eq!(native, vec![json!({"path": path, "type": "localAudio"})]);
    }

    #[test]
    fn prompt_image_should_preserve_requested_detail() {
        let path = std::env::temp_dir()
            .join("diagram.png")
            .to_string_lossy()
            .into_owned();
        let input = AgentPromptInput {
            attachments: vec![json!({
                "detail": "original",
                "id": &path,
                "kind": "image",
                "mediaType": "image/png",
                "name": "diagram.png",
                "size": 17,
            })],
            skills: Vec::new(),
            text: String::new(),
        };

        let native = map_prompt_input(&input).expect("image prompt should map");
        assert_eq!(
            native,
            vec![json!({"detail": "original", "path": path, "type": "localImage"})]
        );
    }
}
