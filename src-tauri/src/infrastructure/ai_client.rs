use crate::domain::{AiSettings, AppError, AppResult, ErrorCode};
use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
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
}

/// Payload received from the frontend (contract `AiChatCompletionInput`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionInput {
    pub messages: Vec<AiChatMessage>,
    #[serde(default)]
    pub temperature: Option<f32>,
}

#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: &'a [AiChatMessage],
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    /// Ask OpenAI-compatible endpoints for SSE streaming. Doubao / DeepSeek /
    /// Kimi / OpenAI all honor this; the non-stream call stays as fallback.
    stream: bool,
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

/// The combined result of one chat completion: visible reply plus the
/// reasoning trace, when the model provides one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AiChatReply {
    pub content: String,
    pub reasoning: String,
}

/// Serializable form returned by the `chat_completion_stream` command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatReplyPayload {
    pub content: String,
    pub reasoning: String,
}

impl From<AiChatReply> for AiChatReplyPayload {
    fn from(reply: AiChatReply) -> Self {
        Self {
            content: reply.content,
            reasoning: reply.reasoning,
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
    let body = ChatRequest {
        model: settings.model.trim(),
        messages: &input.messages,
        temperature: input.temperature,
        stream: false,
    };
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
    let content = parsed
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .filter(|text| !text.trim().is_empty());
    content.ok_or_else(|| AppError::new(ErrorCode::Io, "AI 未返回任何内容。"))
}

/// Streams a chat completion, invoking `on_delta` for each visible content
/// piece and `on_reasoning` for each reasoning piece as they arrive.
/// Falls back to the non-streaming call when the endpoint does not stream.
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
    let body = ChatRequest {
        model: settings.model.trim(),
        messages: &input.messages,
        temperature: input.temperature,
        stream: true,
    };
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
        if content.trim().is_empty() {
            return Err(AppError::new(ErrorCode::Io, "AI 未返回任何内容。"));
        }
        on_delta(&content);
        return Ok(AiChatReply { content, reasoning });
    }

    let mut content = String::new();
    let mut reasoning = String::new();
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
    }
    if content.trim().is_empty() && reasoning.trim().is_empty() {
        return Err(AppError::new(ErrorCode::Io, "AI 未返回任何内容。"));
    }
    Ok(AiChatReply { content, reasoning })
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
        };
        assert!(chat_completion(&settings(), &input).is_err());
        let mut deltas = Vec::new();
        let mut reasoning = Vec::new();
        assert!(chat_completion_stream(&settings(), &input, |d| deltas.push(d.to_string()), |r| reasoning.push(r.to_string())).is_err());
        assert!(deltas.is_empty());
        assert!(reasoning.is_empty());
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
}
