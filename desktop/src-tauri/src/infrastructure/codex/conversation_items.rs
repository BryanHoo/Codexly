use serde_json::{Map, Value, json};

use super::connection::ConnectionError;
use super::conversation_collaboration::{collaboration_tool_name, map_collaboration_agents};
use super::conversation_file_input::read_file_text_input;
use super::conversation_media_input::{map_local_audio_attachment, map_local_image_attachment};
use super::conversation_questions::map_questions;
use super::generated_image_store::IMAGE_ATTACHMENT_FIELD;
use crate::domain::conversation::{AgentCommandOutputOmission, AgentFileChange, AgentItem};

const MAX_COMMAND_OUTPUT_BYTES: usize = 1_048_576;
const MAX_COMMAND_OUTPUT_LINES: usize = 10_000;

pub(super) fn map_item(value: Value) -> Result<AgentItem, ConnectionError> {
    let mut item = map_item_without_skill_normalization(value)?;
    crate::domain::conversation_skills::normalize_user_skill_text(&mut item);
    Ok(item)
}

pub(super) fn map_item_without_skill_normalization(
    value: Value,
) -> Result<AgentItem, ConnectionError> {
    let item = value.as_object().ok_or(ConnectionError::InvalidMessage)?;
    let id = required_string(item, "id")?.to_owned();
    let item_type = required_string(item, "type")?;

    match item_type {
        "reasoning" => Ok(AgentItem::Reasoning {
            id,
            // 仅透出摘要；原始推理内容不进入 IPC。
            text: item["summary"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("\n\n"),
        }),
        "userMessage" => {
            let (text, attachments, skills) = map_user_message(item)?;
            Ok(AgentItem::Message {
                // 在正文规范化前识别纯展开项，不能把清理后变空的普通输入误分类。
                skill_expansion: text.is_empty() && attachments.is_empty() && !skills.is_empty(),
                attachments: (!attachments.is_empty()).then_some(attachments),
                id,
                phase: None,
                questions: None,
                role: "user",
                skills: (!skills.is_empty()).then_some(skills),
                text,
            })
        }
        "agentMessage" => Ok(AgentItem::Message {
            attachments: None,
            id,
            phase: optional_string(item, "phase")?.map(str::to_owned),
            questions: map_questions(item)?,
            role: "assistant",
            skill_expansion: false,
            skills: None,
            text: required_string(item, "text")?.to_owned(),
        }),
        "functionCallOutput" => {
            let name = required_string(item, "name")?;
            let name = optional_string(item, "namespace")?
                .map(|namespace| format!("{namespace}/{name}"))
                .unwrap_or_else(|| name.to_owned());
            let output = item
                .get("output")
                .filter(|output| output.is_string() || output.is_array())
                .cloned()
                .ok_or(ConnectionError::InvalidMessage)?;
            Ok(AgentItem::Tool {
                id,
                input: None,
                name,
                output: Some(output),
                status: "completed",
            })
        }
        "commandExecution" => {
            let (output, output_omitted) = optional_string(item, "aggregatedOutput")?
                .map(bound_command_output)
                .map_or_else(
                    || (None, AgentCommandOutputOmission { bytes: 0, lines: 0 }),
                    |(output, omission)| (Some(output), omission),
                );
            Ok(AgentItem::Command {
                command: required_string(item, "command")?.to_owned(),
                cwd: required_string(item, "cwd")?.to_owned(),
                exit_code: optional_i64(item, "exitCode")?,
                id,
                output,
                output_omitted,
                status: map_status(required_string(item, "status")?, false)?,
            })
        }
        "fileChange" => Ok(AgentItem::FileChange {
            changes: map_file_changes(item)?,
            id,
            status: map_status(required_string(item, "status")?, false)?,
        }),
        "mcpToolCall" | "dynamicToolCall" => Ok(AgentItem::Tool {
            id,
            input: item.get("arguments").cloned(),
            name: tool_name(item, item_type)?,
            output: tool_output(item),
            status: map_status(required_string(item, "status")?, false)?,
        }),
        "plan" => Ok(AgentItem::Plan {
            id,
            text: required_string(item, "text")?.to_owned(),
        }),
        "collabAgentToolCall" => Ok(AgentItem::Tool {
            id,
            input: Some(json!({
                "model": item.get("model").cloned().unwrap_or(Value::Null),
                "prompt": item.get("prompt").cloned().unwrap_or(Value::Null),
                "reasoningEffort": item.get("reasoningEffort").cloned().unwrap_or(Value::Null),
                "receiverTaskIds": item.get("receiverThreadIds").cloned().unwrap_or_else(|| json!([])),
                "senderTaskId": required_string(item, "senderThreadId")?,
            })),
            name: collaboration_tool_name(required_string(item, "tool")?)?.to_owned(),
            output: Some(json!({"agents": map_collaboration_agents(item)?})),
            status: map_status(required_string(item, "status")?, false)?,
        }),
        "webSearch" => Ok(AgentItem::Tool {
            id,
            input: Some(json!({"query": required_string(item, "query")?})),
            name: "web_search".to_owned(),
            output: item
                .get("results")
                .filter(|value| !value.is_null())
                .cloned(),
            status: "completed",
        }),
        "imageGeneration" => {
            if let Some(attachment) = generated_image_attachment(item)? {
                Ok(AgentItem::Message {
                    attachments: Some(vec![attachment]),
                    id,
                    phase: None,
                    questions: None,
                    role: "assistant",
                    skill_expansion: false,
                    skills: None,
                    text: String::new(),
                })
            } else {
                Ok(AgentItem::Tool {
                    id,
                    input: item
                        .get("revisedPrompt")
                        .filter(|value| !value.is_null())
                        .map(|value| json!({"prompt": value})),
                    name: "image_generation".to_owned(),
                    // 失败元数据可以展示，图片正文绝不进入 Tool output。
                    output: item
                        .get("failure")
                        .filter(|value| !value.is_null())
                        .cloned(),
                    status: map_status(required_string(item, "status")?, false)?,
                })
            }
        }
        "hookPrompt" => activity(id, "Hook 提示", None, None, None),
        "subAgentActivity" => {
            let path = required_string(item, "agentPath")?;
            let name = path
                .rsplit('/')
                .find(|part| !part.is_empty())
                .unwrap_or(path);
            let kind = required_string(item, "kind")?;
            let (detail, status) = match kind {
                "started" => ("已启动", "completed"),
                "interacted" => ("已交互", "completed"),
                "interrupted" => ("已中断", "interrupted"),
                "completed" => ("已完成", "completed"),
                _ => return Err(ConnectionError::InvalidMessage),
            };
            activity(
                id,
                &format!("子代理 {name}"),
                Some(detail.to_owned()),
                Some(status),
                None,
            )
        }
        "imageView" => activity(
            id,
            "查看图片",
            Some(required_string(item, "path")?.to_owned()),
            None,
            None,
        ),
        "sleep" => activity(
            id,
            "等待",
            Some(format!(
                "{}ms",
                optional_i64(item, "durationMs")?.unwrap_or(0)
            )),
            None,
            None,
        ),
        "enteredReviewMode" => Ok(AgentItem::Review {
            id,
            target: map_review_target(required_string(item, "review")?),
        }),
        "exitedReviewMode" => Ok(AgentItem::Message {
            attachments: None,
            id,
            phase: None,
            questions: None,
            role: "assistant",
            skill_expansion: false,
            skills: None,
            text: required_string(item, "review")?.to_owned(),
        }),
        "contextCompaction" => activity(id, "上下文压缩", None, None, Some(true)),
        _ => Ok(AgentItem::Activity {
            detail: Some(format!("未识别的活动类型: {item_type}")),
            id,
            label: "Provider 活动".to_owned(),
            status: None,
            transient: None,
        }),
    }
}

pub(super) fn apply_transient_item_lifecycle(item: &mut AgentItem, started: bool) {
    // 瞬时 Item 只在实时生命周期内可见，历史快照不保留运行状态。
    if let AgentItem::Activity {
        status,
        transient: Some(true),
        ..
    } = item
    {
        *status = Some(if started { "running" } else { "completed" });
    }
}

fn bound_command_output(value: &str) -> (String, AgentCommandOutputOmission) {
    let original_bytes = value.len();
    let original_lines = value.bytes().filter(|byte| *byte == b'\n').count();
    let line_bounded = retain_head_tail_lines(value, original_lines);
    let output = retain_head_tail_bytes(&line_bounded);
    let retained_lines = output.bytes().filter(|byte| *byte == b'\n').count();
    (
        output.clone(),
        AgentCommandOutputOmission {
            bytes: original_bytes.saturating_sub(output.len()),
            lines: original_lines.saturating_sub(retained_lines),
        },
    )
}

fn retain_head_tail_lines(value: &str, total_newlines: usize) -> String {
    if total_newlines < MAX_COMMAND_OUTPUT_LINES {
        return value.to_owned();
    }
    let positions = value
        .match_indices('\n')
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    let head_lines = MAX_COMMAND_OUTPUT_LINES.div_ceil(2);
    let tail_lines = MAX_COMMAND_OUTPUT_LINES - head_lines;
    let prefix_end = positions[head_lines - 1];
    let suffix_start = positions[positions.len() - tail_lines] + 1;
    format!("{}\n{}", &value[..prefix_end], &value[suffix_start..])
}

fn retain_head_tail_bytes(value: &str) -> String {
    if value.len() <= MAX_COMMAND_OUTPUT_BYTES {
        return value.to_owned();
    }
    let head_bytes = MAX_COMMAND_OUTPUT_BYTES.div_ceil(2);
    let tail_bytes = MAX_COMMAND_OUTPUT_BYTES - head_bytes;
    let mut head_end = head_bytes;
    while !value.is_char_boundary(head_end) {
        head_end -= 1;
    }
    let mut tail_start = value.len() - tail_bytes;
    while !value.is_char_boundary(tail_start) {
        tail_start += 1;
    }
    format!("{}{}", &value[..head_end], &value[tail_start..])
}

fn activity(
    id: String,
    label: &str,
    detail: Option<String>,
    status: Option<&'static str>,
    transient: Option<bool>,
) -> Result<AgentItem, ConnectionError> {
    Ok(AgentItem::Activity {
        detail,
        id,
        label: label.to_owned(),
        status,
        transient,
    })
}

fn map_review_target(review: &str) -> Value {
    if review == "current changes" {
        return json!({"type": "uncommitted_changes"});
    }
    if let Some(branch) = review
        .strip_prefix("changes against '")
        .and_then(|value| value.strip_suffix('\''))
    {
        return json!({"branch": branch, "type": "base_branch"});
    }
    if let Some(value) = review.strip_prefix("commit ") {
        let (sha, title) = value.split_once(": ").unwrap_or((value, ""));
        let mut target = json!({"sha": sha, "type": "commit"});
        if !title.is_empty() {
            target["title"] = Value::String(title.to_owned());
        }
        return target;
    }
    json!({"instructions": review, "type": "custom"})
}

fn map_user_message(
    item: &Map<String, Value>,
) -> Result<(String, Vec<Value>, Vec<Value>), ConnectionError> {
    let content = item
        .get("content")
        .and_then(Value::as_array)
        .ok_or(ConnectionError::InvalidMessage)?;
    let mut text = Vec::new();
    let mut attachments = Vec::new();
    let mut skills = Vec::new();
    for part in content {
        let Some(part) = part.as_object() else {
            continue;
        };
        match part.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(restored) = read_file_text_input(part)? {
                    if !restored.text.is_empty() {
                        text.push(restored.text);
                    }
                    attachments.extend(restored.attachments);
                } else {
                    text.push(required_string(part, "text")?.to_owned());
                }
            }
            Some("localImage") => attachments.push(map_local_image_attachment(part)?),
            Some("image") => {
                if let Some(url) = part.get("url").and_then(Value::as_str) {
                    attachments.push(json!({
                        "id": url, "kind": "image", "mediaType": "image/png",
                        "name": "image.png", "size": 1,
                    }));
                } else if part
                    .get("fileId")
                    .and_then(Value::as_str)
                    .is_some_and(|file_id| !file_id.is_empty())
                {
                    // 远程 fileId 不能通过本地资源协议读取，仅保留可理解的历史占位。
                    text.push("[图片]".to_owned());
                } else {
                    return Err(ConnectionError::InvalidMessage);
                }
            }
            Some("skill") => skills.push(json!({"name": required_string(part, "name")?})),
            Some("localAudio") => attachments.push(map_local_audio_attachment(part)?),
            Some("audio") => text.push("[音频]".to_owned()),
            _ => {}
        }
    }
    Ok((text.join("\n"), attachments, skills))
}

fn generated_image_attachment(item: &Map<String, Value>) -> Result<Option<Value>, ConnectionError> {
    let Some(attachment) = item.get(IMAGE_ATTACHMENT_FIELD) else {
        return Ok(None);
    };
    let object = attachment
        .as_object()
        .ok_or(ConnectionError::InvalidMessage)?;
    let size = object
        .get("size")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or(ConnectionError::InvalidMessage)?;
    if required_string(object, "kind")? != "image"
        || !matches!(
            required_string(object, "mediaType")?,
            "image/gif" | "image/jpeg" | "image/png" | "image/webp"
        )
        || required_string(object, "name")?.len() > 255
        || size > 50 * 1024 * 1024
        || !std::path::Path::new(required_string(object, "id")?).is_absolute()
    {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(Some(attachment.clone()))
}

fn map_file_changes(item: &Map<String, Value>) -> Result<Vec<AgentFileChange>, ConnectionError> {
    item.get("changes")
        .and_then(Value::as_array)
        .ok_or(ConnectionError::InvalidMessage)?
        .iter()
        .map(|value| {
            let change = value.as_object().ok_or(ConnectionError::InvalidMessage)?;
            let kind = change
                .get("kind")
                .and_then(Value::as_object)
                .and_then(|kind| kind.get("type"))
                .and_then(Value::as_str)
                .ok_or(ConnectionError::InvalidMessage)?;
            let kind = match kind {
                "add" => "create",
                "delete" => "delete",
                "update" => "update",
                _ => return Err(ConnectionError::InvalidMessage),
            };
            let diff = required_string(change, "diff")?;
            let path = required_string(change, "path")?;
            Ok(AgentFileChange {
                stats: crate::domain::file_change::FileChangeStats::codex(kind, diff),
                diff: crate::domain::file_patch::FilePatch::codex(path, kind, diff, usize::MAX)
                    .diff,
                kind,
                path: path.to_owned(),
            })
        })
        .collect()
}

fn tool_name(item: &Map<String, Value>, item_type: &str) -> Result<String, ConnectionError> {
    let tool = required_string(item, "tool")?;
    if item_type == "mcpToolCall" {
        Ok(format!("{}/{tool}", required_string(item, "server")?))
    } else if let Some(namespace) = optional_string(item, "namespace")? {
        Ok(format!("{namespace}/{tool}"))
    } else {
        Ok(tool.to_owned())
    }
}

fn tool_output(item: &Map<String, Value>) -> Option<Value> {
    item.get("result")
        .filter(|value| !value.is_null())
        .or_else(|| item.get("contentItems").filter(|value| !value.is_null()))
        .or_else(|| item.get("error").filter(|value| !value.is_null()))
        .cloned()
}

pub(super) fn map_status(value: &str, turn: bool) -> Result<&'static str, ConnectionError> {
    match value {
        "inProgress" => Ok("running"),
        "completed" => Ok("completed"),
        "failed" => Ok("failed"),
        "interrupted" => Ok("interrupted"),
        "declined" if !turn => Ok("declined"),
        "pending" if !turn => Ok("pending"),
        "running" if !turn => Ok("running"),
        _ => Err(ConnectionError::InvalidMessage),
    }
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ConnectionError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)
}

fn optional_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<Option<&'a str>, ConnectionError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(Some)
            .ok_or(ConnectionError::InvalidMessage),
    }
}

fn optional_i64(object: &Map<String, Value>, key: &str) -> Result<Option<i64>, ConnectionError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_i64()
            .map(Some)
            .ok_or(ConnectionError::InvalidMessage),
    }
}
