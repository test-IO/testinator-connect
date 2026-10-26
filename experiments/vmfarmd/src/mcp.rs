use std::sync::Arc;

use axum::http::request::Parts;
use rmcp::{
    ErrorData, RoleServer, ServerHandler,
    model::{
        CallToolRequestParams, CallToolResponse, Implementation, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerConfig,
    },
    service::RequestContext,
};

use crate::session::{Session, SessionManager};

/// Header that picks the daemon session a request runs in. Without it, the `default` session is used.
pub const SESSION_HEADER: &str = "vmfarmd-session-id";

/// Serves a daemon session's tools over MCP.
#[derive(Clone)]
pub struct McpFrontend {
    sessions: Arc<SessionManager>,
}

impl McpFrontend {
    pub fn new(sessions: Arc<SessionManager>) -> Self {
        Self { sessions }
    }

    async fn session(&self, context: &RequestContext<RoleServer>) -> Result<Arc<Session>, ErrorData> {
        let requested = context
            .extensions
            .get::<Parts>()
            .and_then(|parts| parts.headers.get(SESSION_HEADER))
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let session = match requested {
            Some(id) => self.sessions.get(&id).await,
            None => self.sessions.get_or_start_default().await,
        };
        session.map_err(ErrorData::from)
    }
}

impl ServerHandler for McpFrontend {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("vmfarmd", env!("CARGO_PKG_VERSION")))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let tools = self.session(&context).await?.tools().await?;
        Ok(ListToolsResult::with_all_items(tools))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let session = self.session(&context).await?;
        Ok(session
            .call_tool(request)
            .await
            .unwrap_or_else(|error| error.into_tool_result().into()))
    }
}
