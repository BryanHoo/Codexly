use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo<'a> {
    pub name: &'a str,
    pub title: Option<&'a str>,
    pub version: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeCapabilities {
    pub experimental_api: bool,
    pub opt_out_notification_methods: &'static [&'static str],
}

// 这些通知没有对应桌面产品能力，初始化时关闭可直接减少 JSONL 和队列负载。
pub const IGNORED_NOTIFICATION_METHODS: &[&str] = &[
    "account/rateLimits/updated",
    "app/list/updated",
    "command/exec/outputDelta",
    "configWarning",
    "deprecationNotice",
    "externalAgentConfig/import/completed",
    "externalAgentConfig/import/progress",
    "item/commandExecution/terminalInteraction",
    "item/fileChange/outputDelta",
    "mcpServer/event/stream/notification",
    "mcpServer/oauthLogin/completed",
    "process/exited",
    "process/outputDelta",
    "rawResponse/completed",
    "rawResponseItem/completed",
    "remoteControl/status/changed",
    "project/changed",
    "thread/attachment/updated",
    "thread/closed",
    "thread/compacted",
    "thread/environment/connected",
    "thread/environment/disconnected",
    "thread/project/updated",
    "thread/realtime/closed",
    "thread/realtime/error",
    "thread/realtime/itemAdded",
    "thread/realtime/item/completed",
    "thread/realtime/item/started",
    "thread/realtime/item/transcript/delta",
    "thread/realtime/outputAudio/delta",
    "thread/realtime/sdp",
    "thread/realtime/started",
    "thread/realtime/transcript/delta",
    "thread/realtime/transcript/done",
    "thread/reverted",
    "thread/settings/updated",
    "thread/unarchived",
    "turn/diff/updated",
    "turn/moderationMetadata",
    "windows/worldWritableWarning",
    "windowsSandbox/setupCompleted",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams<'a> {
    pub client_info: ClientInfo<'a>,
    pub capabilities: InitializeCapabilities,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResponse {
    pub user_agent: String,
    pub codex_home: String,
    pub platform_family: String,
    pub platform_os: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct IncomingMessage {
    pub id: Option<u64>,
    pub method: Option<String>,
    pub params: Option<Box<RawValue>>,
    pub result: Option<Box<RawValue>>,
    pub error: Option<RpcError>,
}

#[derive(Serialize)]
struct Request<'a, P> {
    method: &'a str,
    id: u64,
    params: &'a P,
}

#[derive(Serialize)]
struct Notification<'a> {
    method: &'a str,
}

#[derive(Serialize)]
struct Response<'a, R> {
    id: u64,
    result: &'a R,
}

pub fn encode_request<P: Serialize>(
    id: u64,
    method: &str,
    params: &P,
) -> Result<Vec<u8>, serde_json::Error> {
    let mut message = Vec::with_capacity(256);
    serde_json::to_writer(&mut message, &Request { method, id, params })?;
    // stdio 传输以换行划分消息，集中编码可避免多次小块写入。
    message.push(b'\n');
    Ok(message)
}

pub fn encode_notification(method: &str) -> Result<Vec<u8>, serde_json::Error> {
    let mut message = Vec::with_capacity(64);
    serde_json::to_writer(&mut message, &Notification { method })?;
    message.push(b'\n');
    Ok(message)
}

pub fn encode_response<R: Serialize>(id: u64, result: &R) -> Result<Vec<u8>, serde_json::Error> {
    let mut message = Vec::with_capacity(256);
    serde_json::to_writer(&mut message, &Response { id, result })?;
    message.push(b'\n');
    Ok(message)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        ClientInfo, IGNORED_NOTIFICATION_METHODS, InitializeCapabilities, InitializeParams,
        encode_notification, encode_request, encode_response,
    };

    #[test]
    fn initialize_request_should_match_codex_schema() {
        let params = InitializeParams {
            client_info: ClientInfo {
                name: "codeagent",
                title: Some("Codexly"),
                version: "0.1.0",
            },
            capabilities: InitializeCapabilities {
                experimental_api: true,
                opt_out_notification_methods: IGNORED_NOTIFICATION_METHODS,
            },
        };

        let message = encode_request(1, "initialize", &params).expect("request should serialize");

        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&message).expect("request should be JSON"),
            json!({
                "method": "initialize",
                "id": 1,
                "params": {
                    "clientInfo": {
                        "name": "codeagent",
                        "title": "Codexly",
                        "version": "0.1.0"
                    },
                    "capabilities": {
                        "experimentalApi": true,
                        "optOutNotificationMethods": IGNORED_NOTIFICATION_METHODS
                    }
                }
            })
        );
        assert_eq!(message.last(), Some(&b'\n'));
    }

    #[test]
    fn unsupported_codex_152_streams_should_be_disabled_at_initialization() {
        for method in [
            "mcpServer/event/stream/notification",
            "thread/realtime/item/completed",
            "thread/realtime/item/started",
            "thread/realtime/item/transcript/delta",
        ] {
            assert!(IGNORED_NOTIFICATION_METHODS.contains(&method));
        }
    }

    #[test]
    fn initialized_notification_should_omit_empty_params() {
        let message = encode_notification("initialized").expect("notification should serialize");

        assert_eq!(message, b"{\"method\":\"initialized\"}\n");
    }

    #[test]
    fn server_request_response_should_match_codex_transport() {
        let message = encode_response(9, &json!({"decision": "accept"})).unwrap();

        assert_eq!(
            message,
            b"{\"id\":9,\"result\":{\"decision\":\"accept\"}}\n"
        );
    }
}
