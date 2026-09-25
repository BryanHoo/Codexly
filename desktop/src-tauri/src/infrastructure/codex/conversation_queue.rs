use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::{
    AppServerConnection,
    connection::ConnectionError,
    conversation::{NativeTurn, map_turn},
    conversation_file_input::read_file_text_input,
    conversation_media_input::{map_local_audio_attachment, map_local_image_attachment},
    conversation_prompt::map_prompt_input,
};
use crate::domain::conversation::{AgentPromptInput, AgentTurn};

const DEFAULT_PAGE_LIMIT: u32 = 100;
const MAX_PAGE_LIMIT: u32 = 100;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[cfg(test)]
#[path = "conversation_queue_media_tests.rs"]
mod media_tests;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListParams<'a> {
    cursor: Option<&'a str>,
    limit: u32,
    thread_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativePage {
    data: Vec<NativeSubmission>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSubmission {
    client_user_message_id: String,
    id: String,
    input: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedSubmissionPage {
    pub data: Vec<AgentQueuedSubmission>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentQueuedSubmission {
    pub attachments: Vec<Value>,
    pub client_user_message_id: String,
    pub id: String,
    pub skills: Vec<Value>,
    pub status: &'static str,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedSubmissionResponse {
    pub queued_submission: AgentQueuedSubmission,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddParams<'a> {
    client_user_message_id: &'a str,
    input: Vec<Value>,
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmissionIdParams<'a> {
    queued_submission_id: &'a str,
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReorderParams<'a> {
    queued_submission_ids: &'a [String],
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartParams<'a> {
    queued_submission_id: Option<&'a str>,
    thread_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSubmissionResponse {
    queued_submission: NativeSubmission,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DeleteQueuedSubmissionResponse {
    pub deleted: bool,
}

#[derive(Debug, Serialize)]
pub struct ReorderQueuedSubmissionsResponse {
    pub status: &'static str,
}

#[derive(Deserialize)]
struct NativeStartResponse {
    turn: NativeTurn,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartQueuedSubmissionResponse {
    pub task_id: String,
    pub turn: AgentTurn,
}

pub async fn list_queued_submissions(
    connection: &AppServerConnection,
    task_id: &str,
    cursor: Option<&str>,
    limit: Option<u32>,
) -> Result<QueuedSubmissionPage, ConnectionError> {
    let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT);
    if limit == 0 || limit > MAX_PAGE_LIMIT {
        return Err(ConnectionError::InvalidMessage);
    }
    let response: NativePage = connection
        .request(
            "thread/queue/list",
            &ListParams {
                cursor,
                limit,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(QueuedSubmissionPage {
        data: map_submissions(connection, task_id, response.data).await?,
        next_cursor: response.next_cursor,
    })
}

pub async fn add_queued_submission(
    connection: &AppServerConnection,
    task_id: &str,
    input: &AgentPromptInput,
    client_user_message_id: &str,
) -> Result<QueuedSubmissionResponse, ConnectionError> {
    if client_user_message_id.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    let response: NativeSubmissionResponse = connection
        .request(
            "thread/queue/add",
            &AddParams {
                client_user_message_id,
                input: map_prompt_input(input)?,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(QueuedSubmissionResponse {
        queued_submission: map_submissions(connection, task_id, vec![response.queued_submission])
            .await?
            .pop()
            .ok_or(ConnectionError::InvalidMessage)?,
    })
}

pub async fn delete_queued_submission(
    connection: &AppServerConnection,
    task_id: &str,
    submission_id: &str,
) -> Result<DeleteQueuedSubmissionResponse, ConnectionError> {
    connection
        .request(
            "thread/queue/delete",
            &SubmissionIdParams {
                queued_submission_id: required_id(submission_id)?,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await
}

pub async fn reorder_queued_submissions(
    connection: &AppServerConnection,
    task_id: &str,
    submission_ids: &[String],
) -> Result<ReorderQueuedSubmissionsResponse, ConnectionError> {
    if submission_ids.is_empty() || submission_ids.iter().any(|id| id.is_empty()) {
        return Err(ConnectionError::InvalidMessage);
    }
    let _: Value = connection
        .request(
            "thread/queue/reorder",
            &ReorderParams {
                queued_submission_ids: submission_ids,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(ReorderQueuedSubmissionsResponse {
        status: "reordered",
    })
}

pub async fn start_queued_submission(
    connection: &AppServerConnection,
    task_id: &str,
    submission_id: Option<&str>,
) -> Result<StartQueuedSubmissionResponse, ConnectionError> {
    if submission_id.is_some_and(str::is_empty) {
        return Err(ConnectionError::InvalidMessage);
    }
    let response: NativeStartResponse = connection
        .request(
            "thread/queue/start",
            &StartParams {
                queued_submission_id: submission_id,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(StartQueuedSubmissionResponse {
        task_id: task_id.to_owned(),
        turn: map_turn(response.turn)?,
    })
}

fn required_id(value: &str) -> Result<&str, ConnectionError> {
    (!value.is_empty())
        .then_some(value)
        .ok_or(ConnectionError::InvalidMessage)
}

async fn map_submissions(
    connection: &AppServerConnection,
    task_id: &str,
    submissions: Vec<NativeSubmission>,
) -> Result<Vec<AgentQueuedSubmission>, ConnectionError> {
    let has_media = submissions.iter().any(|submission| {
        submission
            .input
            .iter()
            .any(|input| matches!(input["type"].as_str(), Some("image" | "audio")))
    });
    if has_media {
        let store = connection
            .queued_media
            .clone()
            .ok_or(ConnectionError::InvalidMessage)?;
        let task_id = task_id.to_owned();
        // 解码和落盘在阻塞池进行；RPC 接收循环继续排水，不让图片拖慢其他任务。
        return tokio::task::spawn_blocking(move || {
            submissions
                .into_iter()
                .map(|submission| map_submission(submission, Some((&store, &task_id))))
                .collect()
        })
        .await
        .map_err(|_| ConnectionError::InvalidMessage)?;
    }
    submissions
        .into_iter()
        .map(|submission| map_submission(submission, None))
        .collect()
}

fn map_submission(
    native: NativeSubmission,
    media: Option<(&crate::infrastructure::queued_media::QueuedMediaStore, &str)>,
) -> Result<AgentQueuedSubmission, ConnectionError> {
    if native.id.is_empty() || native.client_user_message_id.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    let mut text = String::new();
    let mut attachments = Vec::new();
    let mut skills = Vec::new();
    for input in native.input {
        let object = input.as_object().ok_or(ConnectionError::InvalidMessage)?;
        match object_string_from_map(object, "type")? {
            "text" => {
                if let Some(restored) = read_file_text_input(object)? {
                    text.push_str(&restored.text);
                    attachments.extend(restored.attachments);
                } else {
                    text.push_str(object_string_from_map(object, "text")?);
                }
            }
            "skill" => skills.push(json!({
                "id": object_string_from_map(object, "path")?,
                "name": object_string_from_map(object, "name")?,
            })),
            "localImage" => attachments.push(map_local_image_attachment(object)?),
            "localAudio" => attachments.push(map_local_audio_attachment(object)?),
            "image" | "audio" => {
                let (store, task_id) = media.ok_or(ConnectionError::InvalidMessage)?;
                attachments.push(
                    store
                        .restore(task_id, &input)
                        .map_err(|_| ConnectionError::InvalidMessage)?,
                );
            }
            _ => return Err(ConnectionError::InvalidMessage),
        }
    }
    Ok(AgentQueuedSubmission {
        attachments,
        client_user_message_id: native.client_user_message_id,
        id: native.id,
        skills,
        status: "queued",
        text,
    })
}

fn object_string_from_map<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ConnectionError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(ConnectionError::InvalidMessage)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE_PLACEHOLDER: &str = "codexly-file:eyJraW5kIjoiZmlsZSIsIm1lZGlhVHlwZSI6ImFwcGxpY2F0aW9uL2pzb24iLCJuYW1lIjoicmVwb3J0Lmpzb24iLCJzaXplIjoxN30";

    #[test]
    fn queued_file_should_restore_attachment_without_exposing_its_path_as_text() {
        let path = std::env::temp_dir()
            .join("report.json")
            .to_string_lossy()
            .into_owned();
        let submission = NativeSubmission {
            client_user_message_id: "client-a".to_owned(),
            id: "queue-a".to_owned(),
            input: vec![json!({
                "text": &path,
                "text_elements": [{
                    "byteRange": {"start": 0, "end": path.len()},
                    "placeholder": FILE_PLACEHOLDER,
                }],
                "type": "text",
            })],
        };

        let mapped = map_submission(submission, None).expect("queued file should map");
        assert_eq!(mapped.text, "");
        assert_eq!(mapped.attachments.len(), 1);
        assert_eq!(mapped.attachments[0]["id"], path);
        assert_eq!(mapped.attachments[0]["name"], "report.json");
        assert_eq!(mapped.attachments[0]["mediaType"], "application/json");
    }

    #[test]
    fn queued_local_media_should_restore_native_attachments() {
        let root = std::env::temp_dir();
        let submission = NativeSubmission {
            client_user_message_id: "client-media".to_owned(),
            id: "queue-media".to_owned(),
            input: vec![
                json!({
                    "detail": "auto",
                    "path": root.join("photo.WEBP"),
                    "type": "localImage",
                }),
                json!({
                    "path": root.join("voice.WAV"),
                    "type": "localAudio",
                }),
            ],
        };

        let mapped = map_submission(submission, None).expect("queued media should map");

        assert_eq!(mapped.attachments[0]["detail"], "auto");
        assert_eq!(mapped.attachments[0]["mediaType"], "image/webp");
        assert_eq!(mapped.attachments[1]["kind"], "file");
        assert_eq!(mapped.attachments[1]["mediaType"], "audio/wav");
    }
}
