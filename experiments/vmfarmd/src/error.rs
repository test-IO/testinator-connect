use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use rmcp::{
    ErrorData,
    model::{CallToolResult, ContentBlock},
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum DaemonError {
    #[error("unknown session {0}")]
    UnknownSession(String),
    #[error("session {0} already exists")]
    SessionExists(String),
    #[error("unknown server {0}")]
    UnknownServer(String),
    #[error("unknown tool {0}")]
    UnknownTool(String),
    #[error("could not start MCP server {server}: {source}")]
    Spawn {
        server: String,
        source: std::io::Error,
    },
    #[error("{0} timed out")]
    Timeout(String),
    #[error("MCP server {server}: {message}")]
    Mcp { server: String, message: String },
}

impl DaemonError {
    pub fn mcp(server: &str, error: impl std::fmt::Display) -> Self {
        Self::Mcp {
            server: server.to_owned(),
            message: error.to_string(),
        }
    }

    fn code(&self) -> &'static str {
        match self {
            Self::UnknownSession(_) => "unknown_session",
            Self::SessionExists(_) => "session_exists",
            Self::UnknownServer(_) => "unknown_server",
            Self::UnknownTool(_) => "unknown_tool",
            Self::Spawn { .. } => "spawn_failed",
            Self::Timeout(_) => "timeout",
            Self::Mcp { .. } => "mcp_error",
        }
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::UnknownSession(_) | Self::UnknownTool(_) => StatusCode::NOT_FOUND,
            Self::SessionExists(_) => StatusCode::CONFLICT,
            Self::UnknownServer(_) => StatusCode::BAD_REQUEST,
            Self::Timeout(_) => StatusCode::GATEWAY_TIMEOUT,
            Self::Spawn { .. } | Self::Mcp { .. } => StatusCode::BAD_GATEWAY,
        }
    }

    /// Tool failures go back as an error result, because MCP clients hide the text of protocol errors.
    pub fn into_tool_result(self) -> CallToolResult {
        CallToolResult::error(vec![ContentBlock::text(self.to_string())])
    }
}

impl From<DaemonError> for ErrorData {
    fn from(error: DaemonError) -> Self {
        match error {
            DaemonError::UnknownSession(_)
            | DaemonError::UnknownServer(_)
            | DaemonError::UnknownTool(_) => ErrorData::invalid_params(error.to_string(), None),
            _ => ErrorData::internal_error(error.to_string(), None),
        }
    }
}

impl IntoResponse for DaemonError {
    fn into_response(self) -> Response {
        let body = json!({ "ok": false, "error": { "code": self.code(), "message": self.to_string() } });
        (self.status(), Json(body)).into_response()
    }
}
