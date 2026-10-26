use rmcp::model::{CallToolRequestParams, CallToolResponse, JsonObject};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{error::DaemonError, session::SessionManager};

/// Every operation the daemon accepts, whatever transport carried it.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Command {
    SessionStart {
        session_id: Option<String>,
        servers: Option<Vec<String>>,
    },
    SessionEnd {
        session_id: String,
    },
    Sessions,
    ToolsList {
        session_id: String,
    },
    CallTool {
        session_id: String,
        name: String,
        #[serde(default)]
        arguments: Option<JsonObject>,
    },
    Health,
}

pub async fn execute(sessions: &SessionManager, command: Command) -> Result<Value, DaemonError> {
    match command {
        Command::SessionStart { session_id, servers } => {
            let session = sessions.start(session_id, servers).await?;
            Ok(json!({
                "session_id": session.id(),
                "servers": session.server_names(),
                "tools": session.tools().await?,
            }))
        }
        Command::SessionEnd { session_id } => {
            sessions.end(&session_id, "requested").await?;
            Ok(json!({ "session_id": session_id }))
        }
        Command::Sessions => Ok(json!({ "sessions": sessions.summaries().await })),
        Command::ToolsList { session_id } => {
            let tools = sessions.get(&session_id).await?.tools().await?;
            Ok(json!({ "tools": tools }))
        }
        Command::CallTool { session_id, name, arguments } => {
            let session = sessions.get(&session_id).await?;
            let mut params = CallToolRequestParams::new(name);
            if let Some(arguments) = arguments {
                params = params.with_arguments(arguments);
            }
            match session.call_tool(params).await? {
                CallToolResponse::Complete(result) => {
                    Ok(serde_json::to_value(result).expect("tool results serialize"))
                }
                _ => Err(DaemonError::mcp(
                    session.id(),
                    "tool asked for client input or a task, which /control does not support; use /mcp",
                )),
            }
        }
        Command::Health => Ok(health(sessions).await),
    }
}

pub async fn health(sessions: &SessionManager) -> Value {
    json!({
        "status": "ok",
        "daemon_version": env!("CARGO_PKG_VERSION"),
        "sessions": sessions.summaries().await.len(),
    })
}
