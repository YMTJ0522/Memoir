use crate::domain::{AiSettings, AppError, AppResult, ErrorCode};
use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::time::Duration;
use url::Url;

const CONNECT_TIMEOUT_SECS: u64 = 5;
/// AI generation can take a while — allow up to 2 minutes.
const REQUEST_TIMEOUT_SECS: u64 = 120;

/// One message in an OpenAI-compatible chat conversation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
    /// OpenAI tool_calls carried by assistant messages in agent loops.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<AiToolCall>>,
    /// Name of the tool this message responds to (role=tool).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Optional display name for role=tool results.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl AiChatMessage {
    /// Plain message helper (system/user/assistant without tool fields).
    pub fn plain(role: &str, content: &str) -> Self {
        Self {
            role: role.to_string(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }
}

/// A tool call requested by the model during an agent loop.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiToolCall {
    pub id: String,
    /// OpenAI wire field name is `type` (snake_case struct keeps it explicit).
    #[serde(rename = "type")]
    pub type_: String,
    pub function: AiToolCallFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiToolCallFunction {
    pub name: String,
    /// Raw JSON arguments string; the frontend parses it.
    pub arguments: String,
}

/// A tool definition (OpenAI function-tools schema) sent with the request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiToolDefinition {
    #[serde(rename = "type")]
    pub type_: String,
    pub function: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Wire-format conversion
// ---------------------------------------------------------------------------
// The wire (OpenAI-compatible HTTP) format is snake_case for tool fields
// (`tool_calls`, `tool_call_id`, `type`), while our contracts with the
// frontend are camelCase. Converting via serde_json::Value is the simplest
// way to guarantee the exact key names on the wire without duplicating every
// struct.

fn snake_case_tools(tools: &[AiToolDefinition]) -> serde_json::Value {
    serde_json::json!(tools
        .iter()
        .map(|tool| serde_json::json!({
            "type": tool.type_,
            "function": tool.function,
        }))
        .collect::<Vec<_>>())
}

/// Converts contract messages (camelCase) to wire messages (snake_case tool
/// fields). Plain user/assistant/system messages pass through untouched.
fn wire_messages(messages: &[AiChatMessage]) -> serde_json::Value {
    serde_json::json!(messages
        .iter()
        .map(|message| {
            let mut value = serde_json::json!({
                "role": message.role,
                "content": message.content,
            });
            let object = value.as_object_mut().expect("serde_json::json builds an object");
            if let Some(calls) = &message.tool_calls {
                object.insert(
                    "tool_calls".into(),
                    serde_json::json!(calls
                        .iter()
                        .map(|call| serde_json::json!({
                            "id": call.id,
                            "type": call.type_,
                            "function": {
                                "name": call.function.name,
                                "arguments": call.function.arguments,
                            },
                        }))
                        .collect::<Vec<_>>()),
                );
            }
            if let Some(id) = &message.tool_call_id {
                object.insert("tool_call_id".into(), serde_json::json!(id));
            }
            if let Some(name) = &message.name {
                object.insert("name".into(), serde_json::json!(name));
            }
            value
        })
        .collect::<Vec<_>>())
}

/// Payload received from the frontend (contract `AiChatCompletionInput`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionInput {
    pub messages: Vec<AiChatMessage>,
    #[serde(default)]
    pub temperature: Option<f32>,
    /// Optional tool definitions for agent loops.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<AiToolDefinition>>,
    /// Optional model-side control ("auto", "none", or a named function).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    /// Wire-format messages (snake_case tool fields), built by `wire_messages`.
    messages: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    /// Wire-format tool definitions, built by `snake_case_tools`.
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<String>,
    /// Ask OpenAI-compatible endpoints for SSE streaming. Doubao / DeepSeek /
    /// Kimi / OpenAI all honor this; the non-stream call stays as fallback.
    stream: bool,
    /// Ask reasoning-capable models (DeepSeek V3.1+ / V4, Doubao thinking
    /// models) to emit a thinking trace via `reasoning_content`. Endpoints
    /// that do not know this field simply ignore it.
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<serde_json::Value>,
}

impl ChatRequest {
    fn build(settings: &AiSettings, input: &AiChatCompletionInput, stream: bool) -> Self {
        Self {
            model: settings.model.trim().to_string(),
            messages: wire_messages(&input.messages),
            temperature: input.temperature,
            tools: input.tools.as_ref().map(|tools| snake_case_tools(tools)),
            tool_choice: input.tool_choice.clone(),
            stream,
            // Only the streaming path benefits from a thinking trace; the
            // non-streaming call is a plain connectivity probe.
            thinking: if stream {
                Some(serde_json::json!({ "type": "enabled" }))
            } else {
                None
            },
        }
    }
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ChatResponseMessage {
    content: Option<String>,
    /// Reasoning-model field (DeepSeek-R1 / Doubao thinking models).
    #[serde(default)]
    reasoning_content: Option<String>,
    /// Tool calls requested by the model (agent loop).
    #[serde(default)]
    tool_calls: Option<Vec<StreamToolCall>>,
}

/// A streamed chunk delta. Some providers put reasoning in `reasoning_content`,
/// others (OpenAI o-series) in `reasoning`; accept both.
#[derive(Debug, Deserialize)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    reasoning: Option<String>,
    /// Streamed tool call fragments; index maps to the call slot.
    #[serde(default)]
    tool_calls: Option<Vec<StreamToolCallFragment>>,
}

/// One streamed tool-call fragment (OpenAI streams tool calls in pieces
/// keyed by `index`; the function name arrives once, arguments accumulate).
#[derive(Debug, Clone, Deserialize)]
struct StreamToolCallFragment {
    #[serde(default)]
    index: usize,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<StreamToolCallFragmentFn>,
}

#[derive(Debug, Clone, Deserialize)]
struct StreamToolCallFragmentFn {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

/// A complete tool call (streamed fragments aggregated or non-stream body).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StreamToolCall {
    id: String,
    #[serde(rename = "type")]
    type_: String,
    function: StreamToolCallFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StreamToolCallFunction {
    name: String,
    arguments: String,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
}

fn normalize_base_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

/// Builds the full chat completions endpoint URL:
/// `{base}/chat/completions` (OpenAI-compatible).
pub fn chat_completions_url(base_url: &str) -> AppResult<Url> {
    let normalized = normalize_base_url(base_url);
    if normalized.is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "AI 接口地址未配置。",
        ));
    }
    let mut parsed = Url::parse(&normalized).map_err(|error| {
        AppError::new(ErrorCode::InvalidPath, "AI 接口地址无效。")
            .with_details(error.to_string())
    })?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "AI 接口地址必须是 http(s) 协议。",
        ));
    }
    if parsed.host_str().unwrap_or("").is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "AI 接口地址缺少主机名。",
        ));
    }
    if !parsed.path().ends_with("/chat/completions") {
        // Join the standard OpenAI path onto the configured base.
        let path = parsed.path().trim_end_matches('/').to_string();
        parsed.set_path(&format!("{path}/chat/completions"));
    }
    Ok(parsed)
}

/// Validates that the user has configured everything needed for chat.
pub fn validate_config(settings: &AiSettings) -> AppResult<()> {
    if !settings.enabled {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "AI 功能未启用，请在设置中开启。",
        ));
    }
    if settings.api_key.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "AI API Key 未配置。",
        ));
    }
    if settings.model.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "AI 模型名称未配置。",
        ));
    }
    chat_completions_url(&settings.base_url)?;
    Ok(())
}

fn build_client() -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(map_reqwest)
}

/// The combined result of one chat completion: visible reply, reasoning
/// trace, and any tool calls the model requested (agent loops).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AiChatReply {
    pub content: String,
    pub reasoning: String,
    pub tool_calls: Vec<AiToolCall>,
}

/// Serializable form returned by the `chat_completion_stream` command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatReplyPayload {
    pub content: String,
    pub reasoning: String,
    pub tool_calls: Vec<AiToolCall>,
}

impl From<AiChatReply> for AiChatReplyPayload {
    fn from(reply: AiChatReply) -> Self {
        Self {
            content: reply.content,
            reasoning: reply.reasoning,
            tool_calls: reply.tool_calls,
        }
    }
}

fn map_reqwest(error: reqwest::Error) -> AppError {
    let message = if error.is_timeout() {
        "AI 请求超时。"
    } else if error.is_connect() {
        "无法连接到 AI 服务，请检查网络或接口地址。"
    } else if error.is_builder() {
        "AI 客户端初始化失败。"
    } else {
        "AI 请求失败。"
    };
    AppError::new(ErrorCode::Io, message).with_details(error.to_string())
}

fn map_http_status(status: reqwest::StatusCode) -> AppError {
    let code = status.as_u16();
    let message = match code {
        401 => "AI API Key 无效。",
        403 => "AI 服务拒绝了请求。",
        404 => "AI 接口地址或模型名称不存在。",
        429 => "AI 请求过于频繁，请稍后再试。",
        _ => "AI 服务返回了错误。",
    };
    AppError::new(ErrorCode::Io, message).with_details(format!("HTTP {code}"))
}

/// Converts a wire-format tool call (as parsed from responses) into the
/// contract `AiToolCall`.
fn tool_call_from_wire(call: StreamToolCall) -> AiToolCall {
    AiToolCall {
        id: call.id,
        type_: call.type_,
        function: AiToolCallFunction {
            name: call.function.name,
            arguments: call.function.arguments,
        },
    }
}

/// Sends a chat completion request and returns the assistant's reply text.
/// Kept for the connection test (non-streaming, single probe message).
pub fn chat_completion(
    settings: &AiSettings,
    input: &AiChatCompletionInput,
) -> AppResult<String> {
    validate_config(settings)?;
    if input.messages.is_empty() {
        return Err(AppError::new(ErrorCode::InvalidPath, "对话消息为空。"));
    }
    let url = chat_completions_url(&settings.base_url)?;
    let body = ChatRequest::build(settings, input, false);
    let client = build_client()?;
    let response = client
        .post(url)
        .header(AUTHORIZATION, format!("Bearer {}", settings.api_key.trim()))
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .map_err(map_reqwest)?;
    let status = response.status();
    if !status.is_success() {
        return Err(map_http_status(status));
    }
    let parsed: ChatResponse = response.json().map_err(|error| {
        AppError::new(ErrorCode::Serialization, "AI 响应解析失败。")
            .with_details(error.to_string())
    })?;
    let choice = parsed.choices.into_iter().next();
    let content = choice
        .as_ref()
        .and_then(|c| c.message.content.clone())
        .filter(|text| !text.trim().is_empty());
    content.ok_or_else(|| AppError::new(ErrorCode::Io, "AI 未返回任何内容。"))
}

/// Streams a chat completion, invoking `on_delta` for each visible content
/// piece and `on_reasoning` for each reasoning piece as they arrive.
/// Falls back to the non-streaming call when the endpoint does not stream.
/// When the model requests tool calls (agent loop), the aggregated calls are
/// returned in `AiChatReply::tool_calls` and the content may be empty.
pub fn chat_completion_stream(
    settings: &AiSettings,
    input: &AiChatCompletionInput,
    mut on_delta: impl FnMut(&str),
    mut on_reasoning: impl FnMut(&str),
) -> AppResult<AiChatReply> {
    validate_config(settings)?;
    if input.messages.is_empty() {
        return Err(AppError::new(ErrorCode::InvalidPath, "对话消息为空。"));
    }
    let url = chat_completions_url(&settings.base_url)?;
    let body = ChatRequest::build(settings, input, true);
    let client = build_client()?;
    let response = client
        .post(url)
        .header(AUTHORIZATION, format!("Bearer {}", settings.api_key.trim()))
        .header(CONTENT_TYPE, "application/json")
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .map_err(map_reqwest)?;
    let status = response.status();
    if !status.is_success() {
        return Err(map_http_status(status));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    // Some gateways answer a stream request with a plain JSON body; handle that.
    if !content_type.contains("text/event-stream") {
        let parsed: ChatResponse = response.json().map_err(|error| {
            AppError::new(ErrorCode::Serialization, "AI 响应解析失败。")
                .with_details(error.to_string())
        })?;
        let message = parsed.choices.into_iter().next().map(|c| c.message);
        let tool_calls: Vec<AiToolCall> = message
            .as_ref()
            .and_then(|m| m.tool_calls.clone())
            .map(|calls| calls.into_iter().map(tool_call_from_wire).collect())
            .unwrap_or_default();
        let content = message
            .as_ref()
            .and_then(|m| m.content.clone())
            .unwrap_or_default();
        let reasoning = message
            .and_then(|m| m.reasoning_content)
            .unwrap_or_default();
        if !reasoning.is_empty() {
            on_reasoning(&reasoning);
        }
        if !content.is_empty() {
            on_delta(&content);
        }
        if content.trim().is_empty() && reasoning.trim().is_empty() && tool_calls.is_empty() {
            return Err(AppError::new(ErrorCode::Io, "AI 未返回任何内容。"));
        }
        return Ok(AiChatReply {
            content,
            reasoning,
            tool_calls,
        });
    }

    let mut content = String::new();
    let mut reasoning = String::new();
    // Tool-call fragments keyed by `index`: (id, function-name, arguments).
    // The name arrives on the first fragment; arguments accumulate as pieces.
    let mut tool_fragments: BTreeMap<usize, ToolCallAccumulator> = BTreeMap::new();
    let reader = BufReader::new(response);
    for line in reader.lines() {
        let line = line.map_err(|error| {
            AppError::new(ErrorCode::Io, "AI 流式响应中断。").with_details(error.to_string())
        })?;
        let line = line.trim();
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        let Some(payload) = line.strip_prefix("data:") else {
            continue;
        };
        let payload = payload.trim();
        if payload == "[DONE]" {
            break;
        }
        let Ok(chunk) = serde_json::from_str::<StreamChunk>(payload) else {
            continue;
        };
        let Some(choice) = chunk.choices.into_iter().next() else {
            continue;
        };
        if let Some(piece) = choice.delta.reasoning_content.as_deref().filter(|p| !p.is_empty()) {
            reasoning.push_str(piece);
            on_reasoning(piece);
        }
        if let Some(piece) = choice.delta.reasoning.as_deref().filter(|p| !p.is_empty()) {
            reasoning.push_str(piece);
            on_reasoning(piece);
        }
        if let Some(piece) = choice.delta.content.as_deref().filter(|p| !p.is_empty()) {
            content.push_str(piece);
            on_delta(piece);
        }
        for fragment in choice.delta.tool_calls.unwrap_or_default() {
            let entry = tool_fragments.entry(fragment.index).or_default();
            if let Some(id) = fragment.id {
                if entry.id.is_empty() {
                    entry.id = id;
                }
            }
            if let Some(function) = fragment.function {
                if let Some(name) = function.name {
                    if entry.name.is_empty() {
                        entry.name = name;
                    }
                }
                if let Some(arguments) = function.arguments {
                    entry.arguments.push_str(&arguments);
                }
            }
        }
    }
    let tool_calls = aggregate_tool_fragments(tool_fragments);
    if content.trim().is_empty()
        && reasoning.trim().is_empty()
        && tool_calls.is_empty()
    {
        return Err(AppError::new(ErrorCode::Io, "AI 未返回任何内容。"));
    }
    Ok(AiChatReply {
        content,
        reasoning,
        tool_calls,
    })
}

/// Streaming accumulator for one tool call slot.
#[derive(Debug, Default, Clone)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

/// Aggregates streamed tool-call fragments into complete `AiToolCall`s.
fn aggregate_tool_fragments(
    fragments: BTreeMap<usize, ToolCallAccumulator>,
) -> Vec<AiToolCall> {
    fragments
        .into_values()
        .enumerate()
        .map(|(position, fragment)| AiToolCall {
            id: if fragment.id.is_empty() {
                format!("call_{position}")
            } else {
                fragment.id
            },
            type_: "function".to_string(),
            function: AiToolCallFunction {
                name: if fragment.name.is_empty() {
                    "unknown".to_string()
                } else {
                    fragment.name
                },
                arguments: if fragment.arguments.trim().is_empty() {
                    "{}".to_string()
                } else {
                    fragment.arguments
                },
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> AiSettings {
        AiSettings {
            enabled: true,
            base_url: "https://ark.cn-beijing.volces.com/api/v3".into(),
            api_key: "sk-test".into(),
            model: "doubao-1-5-pro-32k-250115".into(),
        }
    }

    #[test]
    fn appends_chat_completions_path() {
        let url = chat_completions_url("https://ark.cn-beijing.volces.com/api/v3").unwrap();
        assert_eq!(
            url.as_str(),
            "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
        );
    }

    #[test]
    fn keeps_existing_chat_completions_path() {
        let url = chat_completions_url("https://api.openai.com/v1/chat/completions").unwrap();
        assert_eq!(url.as_str(), "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn strips_trailing_slash() {
        let url = chat_completions_url("https://example.com/v1/").unwrap();
        assert_eq!(url.as_str(), "https://example.com/v1/chat/completions");
    }

    #[test]
    fn rejects_empty_base_url() {
        assert!(chat_completions_url("").is_err());
        assert!(chat_completions_url("   ").is_err());
    }

    #[test]
    fn rejects_non_http_scheme() {
        assert!(chat_completions_url("ftp://example.com/v1").is_err());
    }

    #[test]
    fn validate_config_checks_fields() {
        let mut s = settings();
        assert!(validate_config(&s).is_ok());

        s.enabled = false;
        assert!(validate_config(&s).is_err());

        s = settings();
        s.api_key = "  ".into();
        assert!(validate_config(&s).is_err());

        s = settings();
        s.model = String::new();
        assert!(validate_config(&s).is_err());
    }

    #[test]
    fn empty_messages_rejected() {
        let input = AiChatCompletionInput {
            messages: vec![],
            temperature: None,
            tools: None,
            tool_choice: None,
        };
        assert!(chat_completion(&settings(), &input).is_err());
        let mut deltas = Vec::new();
        let mut reasoning = Vec::new();
        assert!(chat_completion_stream(&settings(), &input, |d| deltas.push(d.to_string()), |r| reasoning.push(r.to_string())).is_err());
        assert!(deltas.is_empty());
        assert!(reasoning.is_empty());
    }

    #[test]
    fn empty_messages_rejected_with_plain_helper() {
        let input = AiChatCompletionInput {
            messages: vec![AiChatMessage::plain("user", "ping")],
            temperature: None,
            tools: None,
            tool_choice: None,
        };
        assert_eq!(input.messages[0].role, "user");
        assert_eq!(input.messages[0].content, "ping");
        assert!(input.messages[0].tool_calls.is_none());
    }

    #[test]
    fn stream_chunk_parses_reasoning_and_content() {
        let payload = r#"{"choices":[{"delta":{"reasoning_content":"思考","content":"回答"},"finish_reason":null}]}"#;
        let chunk: StreamChunk = serde_json::from_str(payload).unwrap();
        let choice = chunk.choices.into_iter().next().unwrap();
        assert_eq!(choice.delta.content.as_deref(), Some("回答"));
        assert_eq!(choice.delta.reasoning_content.as_deref(), Some("思考"));
    }

    #[test]
    fn stream_chunk_ignores_unknown_fields() {
        let payload = r#"{"id":"x","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"}}]}"#;
        let chunk: StreamChunk = serde_json::from_str(payload).unwrap();
        assert!(chunk.choices[0].delta.content.is_none());
    }

    #[test]
    fn wire_messages_uses_snake_case_tool_fields() {
        let messages = vec![
            AiChatMessage::plain("user", "找笔记"),
            AiChatMessage {
                role: "assistant".into(),
                content: String::new(),
                tool_calls: Some(vec![AiToolCall {
                    id: "call_1".into(),
                    type_: "function".into(),
                    function: AiToolCallFunction {
                        name: "search_notes".into(),
                        arguments: "{\"query\":\"笔记\"}".into(),
                    },
                }]),
                tool_call_id: None,
                name: None,
            },
            AiChatMessage {
                role: "tool".into(),
                content: "[]".into(),
                tool_calls: None,
                tool_call_id: Some("call_1".into()),
                name: Some("search_notes".into()),
            },
        ];
        let wire = wire_messages(&messages);
        let text = serde_json::to_string(&wire).unwrap();
        assert!(text.contains("\"tool_calls\""));
        assert!(text.contains("\"tool_call_id\""));
        // camelCase variants must NOT leak onto the wire.
        assert!(!text.contains("toolCalls"));
        assert!(!text.contains("toolCallId"));
        let second = &wire[1];
        assert_eq!(second["tool_calls"][0]["type"], "function");
        assert_eq!(second["tool_calls"][0]["function"]["name"], "search_notes");
        let third = &wire[2];
        assert_eq!(third["role"], "tool");
        assert_eq!(third["tool_call_id"], "call_1");
    }

    #[test]
    fn snake_case_tools_renames_type_field() {
        let tools = vec![AiToolDefinition {
            type_: "function".into(),
            function: serde_json::json!({
                "name": "search_notes",
                "parameters": { "type": "object", "properties": {} },
            }),
        }];
        let wire = snake_case_tools(&tools);
        let text = serde_json::to_string(&wire).unwrap();
        assert!(text.contains("\"type\""));
        assert!(!text.contains("\"type_\""));
        assert_eq!(wire[0]["function"]["name"], "search_notes");
    }

    #[test]
    fn chat_request_build_includes_tools_and_choice() {
        let input = AiChatCompletionInput {
            messages: vec![AiChatMessage::plain("user", "hi")],
            temperature: Some(0.2),
            tools: Some(vec![AiToolDefinition {
                type_: "function".into(),
                function: serde_json::json!({ "name": "noop" }),
            }]),
            tool_choice: Some("auto".into()),
        };
        let body = ChatRequest::build(&settings(), &input, true);
        let text = serde_json::to_string(&body).unwrap();
        assert!(text.contains("\"tools\""));
        assert!(text.contains("\"tool_choice\":\"auto\""));
        assert!(text.contains("\"stream\":true"));
    }

    #[test]
    fn aggregates_streamed_tool_call_fragments() {
        let mut fragments = BTreeMap::new();
        let mut first = ToolCallAccumulator::default();
        first.id = "call_9".into();
        first.name = "read_note".into();
        first.arguments = "{\"path\":\"a.md\"}".into();
        fragments.insert(0, first);
        // Second slot streamed in two argument pieces, no id/name.
        let mut second = ToolCallAccumulator::default();
        second.arguments = "{\"q\":\"a".into();
        fragments.insert(1, second.clone());
        second.arguments.push_str("b\"}");
        fragments.insert(1, second);        let calls = aggregate_tool_fragments(fragments);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].id, "call_9");
        assert_eq!(calls[0].function.name, "read_note");
        assert_eq!(calls[0].function.arguments, "{\"path\":\"a.md\"}");
        assert_eq!(calls[1].id, "call_1");
        assert_eq!(calls[1].function.name, "unknown");
        assert_eq!(calls[1].function.arguments, "{\"q\":\"ab\"}");
    }

    #[test]
    fn empty_tool_fragment_arguments_become_empty_object() {
        let mut fragments = BTreeMap::new();
        let mut acc = ToolCallAccumulator::default();
        acc.id = "call_1".into();
        acc.name = "list_tags".into();
        fragments.insert(0, acc);
        let calls = aggregate_tool_fragments(fragments);
        assert_eq!(calls[0].function.arguments, "{}");
    }

    #[test]
    fn chat_response_parses_tool_calls() {
        let payload = r#"{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"search_notes","arguments":"{}"}}]}}]}"#;
        let parsed: ChatResponse = serde_json::from_str(payload).unwrap();
        let message = parsed.choices.into_iter().next().unwrap().message;
        let calls = message.tool_calls.unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].function.name, "search_notes");
        let converted = tool_call_from_wire(calls.into_iter().next().unwrap());
        assert_eq!(converted.type_, "function");
    }

    #[test]
    fn chat_reply_payload_serializes_tool_calls_camel_case() {
        let reply = AiChatReply {
            content: String::new(),
            reasoning: String::new(),
            tool_calls: vec![AiToolCall {
                id: "call_1".into(),
                type_: "function".into(),
                function: AiToolCallFunction {
                    name: "noop".into(),
                    arguments: "{}".into(),
                },
            }],
        };
        let payload: AiChatReplyPayload = reply.into();
        let text = serde_json::to_string(&payload).unwrap();
        assert!(text.contains("\"toolCalls\""));
        // Wire payload to the frontend is camelCase, and `type` stays short.
        assert!(text.contains("\"type\":\"function\""));
    }
}
